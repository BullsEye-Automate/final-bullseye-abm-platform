import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Endpoints posibles para contactos en Lemlist (probar en orden)
const CONTACT_PATHS = [
  (id: string) => `https://api.lemlist.com/api/contacts/${id}`,
  (id: string) => `https://api.lemlist.com/api/leads/${id}`,
];

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

  // 1. Traer lista de leads de la campaña (solo _id, state, contactId)
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

  // Probar el endpoint correcto con el primer contactId
  const firstContactId = leads[0]?.contactId;
  let workingPath: ((id: string) => string) | null = null;
  let debugFirstContact: any = null;

  if (firstContactId) {
    for (const pathFn of CONTACT_PATHS) {
      const r = await fetch(pathFn(firstContactId), {
        headers: { Authorization: `Basic ${credentials}` },
        cache: "no-store",
      });
      if (r.ok) {
        workingPath = pathFn;
        debugFirstContact = await r.json();
        break;
      }
    }
  }

  // Si ningún endpoint funcionó, devolver debug para entender la estructura
  if (!workingPath) {
    return NextResponse.json({
      error: "No se pudo obtener datos del contacto desde Lemlist",
      debug: {
        first_lead: leads[0],
        tried_paths: CONTACT_PATHS.map((fn) => fn(firstContactId ?? "NOID")),
      },
    }, { status: 502 });
  }

  // 2. Buscar contactos completos en paralelo (lotes de 10)
  const BATCH = 10;
  const contactData: any[] = [{ ...debugFirstContact, _leadId: leads[0]._id, _contactId: firstContactId }];

  for (let i = 1; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (lead: any) => {
        if (!lead.contactId) return null;
        const r = await fetch(workingPath!(lead.contactId), {
          headers: { Authorization: `Basic ${credentials}` },
          cache: "no-store",
        }).catch(() => null);
        if (!r?.ok) return null;
        const c = await r.json().catch(() => null);
        if (!c) return null;
        return { ...c, _leadId: lead._id, _contactId: lead.contactId };
      })
    );
    contactData.push(...results.filter(Boolean));
  }

  // 3. Upsert en Supabase
  let imported = 0;
  let skipped  = 0;

  for (const c of contactData) {
    const email = (c.email ?? c.linkedinEmail ?? "").trim().toLowerCase();
    if (!email) { skipped++; continue; }

    const row: Record<string, string> = {
      client_id,
      email,
      lemlist_status: "active",
    };
    // Guardar IDs de Lemlist si las columnas existen (migration puede no haberse corrido aún)
    if (c._contactId) row.lemlist_contact_id = c._contactId;
    if (c._leadId)    row.lemlist_lead_id    = c._leadId;

    if (c.firstName   ?? c.first_name)   row.first_name   = c.firstName   ?? c.first_name;
    if (c.lastName    ?? c.last_name)    row.last_name    = c.lastName    ?? c.last_name;
    if (c.companyName ?? c.company_name) row.company_name = c.companyName ?? c.company_name;
    if (c.jobTitle    ?? c.job_title)    row.job_title    = c.jobTitle    ?? c.job_title;
    if (c.linkedinUrl ?? c.linkedin_url) row.linkedin_url = c.linkedinUrl ?? c.linkedin_url;
    if (c.phone)                         row.phone        = c.phone;

    // Intentar upsert por lemlist_contact_id; si falla (columna no existe), insertar por email
    const { error } = await db
      .from("contacts")
      .insert(row);

    if (!error) {
      imported++;
    } else if ((error as any).code === "23505") {
      // Duplicado — actualizar el existente por email
      const { error: updErr } = await db
        .from("contacts")
        .update(row)
        .eq("client_id", client_id)
        .eq("email", email);
      if (!updErr) imported++;
      else skipped++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({
    imported,
    skipped,
    total_leads: leads.length,
    contacts_fetched: contactData.length,
    contact_fields: Object.keys(debugFirstContact ?? {}),
  });
}
