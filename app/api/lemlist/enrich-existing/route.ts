import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Re-pushea a Lemlist los contactos del cliente que ya están en campaña pero sin email,
// activando la query de enriquecimiento (findEmail + findPhone + linkedinEnrichment).
// Lemlist consume sus créditos para buscar email + teléfono del lead y luego lo refleja
// al sincronizar con HubSpot nativamente.
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

  // 1. Traer leads existentes en la campaña (solo _id, contactId)
  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=500`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  if (!leadsRes.ok) {
    const text = await leadsRes.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist ${leadsRes.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const rawLeads = await leadsRes.json();
  const leads: any[] = Array.isArray(rawLeads) ? rawLeads : (rawLeads.leads ?? rawLeads.list ?? []);

  if (leads.length === 0) {
    return NextResponse.json({ enriched: 0, total_leads: 0 });
  }

  // 2. Para cada lead: obtener su linkedinUrl desde /api/contacts/{contactId}
  //    y re-pushear con enrichment query
  let enriched   = 0;
  let alreadyOk  = 0;
  let noLinkedin = 0;
  let failed     = 0;
  const sampleErrors: string[] = [];

  for (const lead of leads) {
    if (!lead.contactId) { noLinkedin++; continue; }

    // Traer datos del contacto
    const contactRes = await fetch(
      `https://api.lemlist.com/api/contacts/${lead.contactId}`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    ).catch(() => null);

    if (!contactRes?.ok) { failed++; continue; }
    const contact = await contactRes.json().catch(() => null);
    if (!contact) { failed++; continue; }

    // Si ya tiene email, no hace falta enriquecer
    if (contact.email?.trim()) {
      alreadyOk++;
      continue;
    }

    const linkedinUrl = contact.linkedinUrl ?? contact.linkedinUrlSalesNav;
    if (!linkedinUrl) { noLinkedin++; continue; }

    // Re-pushear el lead con linkedinUrl + query de enriquecimiento
    // Usar el endpoint sin email en la URL (Lemlist soporta lookup por linkedinUrl en body)
    const enrichRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?findEmail=true&verifyEmail=true&linkedinEnrichment=true&deduplicate=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          linkedinUrl,
          firstName:   contact.firstName   ?? (contact.fullName?.split(/\s+/)[0] ?? undefined),
          lastName:    contact.lastName    ?? (contact.fullName?.split(/\s+/).slice(1).join(" ") ?? undefined),
          companyName: contact.companyName ?? contact.fields?.companyName ?? undefined,
        }),
      }
    ).catch(() => null);

    if (enrichRes?.ok || enrichRes?.status === 409) {
      enriched++;
    } else {
      failed++;
      if (sampleErrors.length < 3 && enrichRes) {
        const t = await enrichRes.text().catch(() => "");
        sampleErrors.push(`${enrichRes.status}: ${t.slice(0, 120)}`);
      }
    }

    // Pausa para no saturar Lemlist
    await new Promise((res) => setTimeout(res, 100));
  }

  return NextResponse.json({
    enriched,
    already_ok: alreadyOk,
    no_linkedin: noLinkedin,
    failed,
    total_leads: leads.length,
    sample_errors: sampleErrors,
  });
}
