import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getClientLemlistConfig } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal de debug — ver la estructura real de un lead de la
// Campaña puente tal como la devuelve Lemlist, sin ninguna normalización.
// Borrar una vez resuelto el parseo de fechas/empresa en lib/lemlist.ts.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const config = await getClientLemlistConfig(db, clientId);
  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) return NextResponse.json({ error: "No hay Campaña puente configurada" }, { status: 400 });

  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "No hay API key de Lemlist" }, { status: 500 });

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  const listRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${stagingId}/leads?limit=2`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );
  const listRaw = await listRes.json().catch(() => ({}));
  const listLeads: any[] = listRaw.items ?? listRaw.leads ?? listRaw.list ?? (Array.isArray(listRaw) ? listRaw : []);

  let contactRaw: unknown = null;
  const firstContactId = listLeads[0]?.contactId;
  if (firstContactId) {
    const contactRes = await fetch(`https://api.lemlist.com/api/contacts/${firstContactId}`, {
      headers: { Authorization: `Basic ${credentials}` },
      cache: "no-store",
    });
    contactRaw = await contactRes.json().catch(() => ({ error: `status ${contactRes.status}` }));
  }

  return NextResponse.json({
    staging_campaign_id: stagingId,
    list_status: listRes.status,
    list_response_top_level_keys: Object.keys(listRaw),
    list_total_returned: listLeads.length,
    first_list_lead_keys: listLeads[0] ? Object.keys(listLeads[0]) : [],
    first_list_lead_raw: listLeads[0] ?? null,
    second_list_lead_raw: listLeads[1] ?? null,
    first_contact_detail_keys: contactRaw && typeof contactRaw === "object" ? Object.keys(contactRaw as object) : [],
    first_contact_detail_raw: contactRaw,
  });
}
