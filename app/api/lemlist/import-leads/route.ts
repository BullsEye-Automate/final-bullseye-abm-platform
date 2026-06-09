import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { client_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id } = body;
  if (!client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, client_id);
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", client_id)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada para este cliente" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  // 1. Traer lista de leads
  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=500`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  if (!leadsRes.ok) {
    const text = await leadsRes.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist leads ${leadsRes.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const rawLeads = await leadsRes.json();
  const leads: any[] = Array.isArray(rawLeads) ? rawLeads : (rawLeads.leads ?? rawLeads.list ?? []);

  if (leads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // 2. Traer cada contacto (secuencial con micro-delay para evitar rate limit)
  const contactData: any[] = [];
  let fetchFailed = 0;

  for (const lead of leads) {
    if (!lead.contactId) continue;
    const r = await fetch(
      `https://api.lemlist.com/api/contacts/${lead.contactId}`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    ).catch(() => null);

    if (!r?.ok) { fetchFailed++; continue; }
    const c = await r.json().catch(() => null);
    if (!c) { fetchFailed++; continue; }
    contactData.push({ ...c, _leadId: lead._id, _contactId: lead.contactId });

    // Pausa de 50ms para no saturar la API
    await new Promise((res) => setTimeout(res, 50));
  }

  // 3. Pre-cargar mapa de contactos existentes por linkedin_url
  const linkedinUrls = contactData
    .map((c) => c.linkedinUrl)
    .filter(Boolean) as string[];

  const existingByLinkedin = new Map<string, string>(); // url → id

  if (linkedinUrls.length > 0) {
    // Buscar en chunks de 100
    for (let i = 0; i < linkedinUrls.length; i += 100) {
      const chunk = linkedinUrls.slice(i, i + 100);
      const { data: existing } = await db
        .from("contacts")
        .select("id, linkedin_url")
        .eq("client_id", client_id)
        .in("linkedin_url", chunk);

      for (const row of existing ?? []) {
        if (row.linkedin_url) existingByLinkedin.set(row.linkedin_url, row.id);
      }
    }
  }

  // 4. Para cada contacto: actualizar si existe por linkedin, insertar si no
  let matched = 0;
  let created = 0;
  let skipped = 0;
  const sampleErrors: string[] = [];

  for (const c of contactData) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email) { skipped++; continue; }

    // Lemlist devuelve fullName — dividir en first/last
    const fullName = (c.fullName ?? "").trim();
    const parts = fullName.split(/\s+/);
    const firstName = parts[0] ?? null;
    const lastName  = parts.slice(1).join(" ") || null;

    // Empresa puede estar en c.fields o c.company
    const fields = c.fields ?? {};
    const companyName = fields.companyName ?? fields.company_name ?? c.companyName ?? c.company ?? null;
    const jobTitle    = fields.jobTitle    ?? fields.job_title    ?? c.jobTitle    ?? null;
    const phone       = fields.phone       ?? c.phone             ?? null;

    const row: Record<string, string> = { client_id, email, lemlist_status: "active" };
    if (firstName)   row.first_name   = firstName;
    if (lastName)    row.last_name    = lastName;
    if (companyName) row.company_name = companyName;
    if (jobTitle)    row.job_title    = jobTitle;
    if (c.linkedinUrl) row.linkedin_url = c.linkedinUrl;
    if (phone)       row.phone        = phone;

    const existingId = c.linkedinUrl ? existingByLinkedin.get(c.linkedinUrl) : undefined;

    if (existingId) {
      // Actualizar fila existente
      const { error } = await db.from("contacts").update(row).eq("id", existingId);
      if (!error) matched++;
      else { skipped++; if (sampleErrors.length < 3) sampleErrors.push(error.message); }
    } else {
      // Insertar nueva
      const { error } = await db.from("contacts").insert(row);
      if (!error) {
        created++;
      } else if ((error as any).code === "23505") {
        // Conflicto — probablemente linkedin duplicado en otro cliente, o email duplicado
        // Intentar update por email
        const { error: updErr } = await db
          .from("contacts")
          .update(row)
          .eq("client_id", client_id)
          .eq("email", email);
        if (!updErr) matched++;
        else { skipped++; if (sampleErrors.length < 3) sampleErrors.push(updErr.message); }
      } else {
        skipped++;
        if (sampleErrors.length < 3) sampleErrors.push(error.message);
      }
    }
  }

  return NextResponse.json({
    imported: matched + created,
    matched,
    created,
    skipped,
    total_leads: leads.length,
    fetched_contacts: contactData.length,
    fetch_failed: fetchFailed,
    sample_errors: sampleErrors,
    sample_contact: contactData[0] ?? null,
  });
}
