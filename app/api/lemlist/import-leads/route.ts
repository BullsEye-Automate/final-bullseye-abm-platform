import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
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

  // 1. Traer todos los leads de la campaña (solo tienen _id, state, contactId)
  const res = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=500`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const raw = await res.json();
  const leads: any[] = Array.isArray(raw) ? raw : (raw.leads ?? raw.list ?? []);

  if (leads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // 2. Para cada lead, buscar el contacto completo (email, nombre, etc.)
  //    Hacerlo en paralelo por lotes de 10 para no saturar la API
  const BATCH = 10;
  const contacts: any[] = [];

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (lead: any) => {
        const contactId = lead.contactId;
        if (!contactId) return null;

        const r = await fetch(
          `https://api.lemlist.com/api/people/${contactId}`,
          { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
        );
        if (!r.ok) return null;

        const c = await r.json();
        return { ...c, _leadId: lead._id, _contactId: contactId };
      })
    );
    contacts.push(...results.filter(Boolean));
  }

  // 3. Upsert en Supabase usando lemlist_contact_id como clave
  let imported = 0;
  let skipped  = 0;

  for (const c of contacts) {
    const email = (c.email ?? c.linkedinEmail ?? "").trim().toLowerCase();
    if (!email) { skipped++; continue; }

    const row: Record<string, string> = {
      client_id,
      email,
      lemlist_contact_id: c._contactId,
      lemlist_lead_id:    c._leadId,
      lemlist_status:     "active",
    };
    if (c.firstName   ?? c.first_name)   row.first_name   = c.firstName   ?? c.first_name;
    if (c.lastName    ?? c.last_name)    row.last_name    = c.lastName    ?? c.last_name;
    if (c.companyName ?? c.company_name) row.company_name = c.companyName ?? c.company_name;
    if (c.jobTitle    ?? c.job_title)    row.job_title    = c.jobTitle    ?? c.job_title;
    if (c.linkedinUrl ?? c.linkedin_url) row.linkedin_url = c.linkedinUrl ?? c.linkedin_url;
    if (c.phone)                         row.phone        = c.phone;

    const { error } = await db
      .from("contacts")
      .upsert(row, { onConflict: "lemlist_contact_id" });

    if (!error) imported++;
    else skipped++;
  }

  return NextResponse.json({ imported, skipped, total_leads: leads.length, total_contacts_fetched: contacts.length });
}
