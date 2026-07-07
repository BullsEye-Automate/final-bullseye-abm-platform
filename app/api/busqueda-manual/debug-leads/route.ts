import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getClientLemlistConfig, getCampaignLeadsWithDetails, resolveManualSearchCampaignId, inferCompanyNameFromBioRaw } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal de debug — ver la estructura real de un lead de la
// Campaña puente tal como la devuelve Lemlist, sin ninguna normalización.
// Borrar una vez resuelto el parseo de fechas/empresa en lib/lemlist.ts.
async function listClientsHint(db: ReturnType<typeof supabaseAdmin>) {
  const { data: clients } = await db.from("clients").select("id, name").order("name");
  const { data: configs } = await db
    .from("client_configs")
    .select("client_id, lemlist_staging_campaign_id, lemlist_manual_search_campaign_id");
  const configByClient = new Map((configs ?? []).map((c) => [c.client_id, c]));
  return (clients ?? []).map((c) => {
    const cfg = configByClient.get(c.id) as any;
    return {
      id: c.id,
      name: c.name,
      has_staging_campaign: Boolean(cfg?.lemlist_staging_campaign_id),
      has_manual_search_campaign: Boolean(cfg?.lemlist_manual_search_campaign_id),
    };
  });
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const db = supabaseAdmin();

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id", clients: await listClientsHint(db) }, { status: 400 });
  }

  const config = await getClientLemlistConfig(db, clientId);
  const stagingId = resolveManualSearchCampaignId(config);
  if (!stagingId) {
    return NextResponse.json(
      { error: "No hay Campaña puente configurada para ese client_id", clients: await listClientsHint(db) },
      { status: 400 }
    );
  }

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

  // Corre el pipeline real de extracción (mapRawLead + enrichment + fallback
  // de bio por IA) para ver el resultado final, no solo los datos crudos.
  const processed = await getCampaignLeadsWithDetails(stagingId, apiKey);

  // Prueba directa del fallback de IA sobre la bio del primer contacto, sin
  // try/catch, para ver el error real si Claude falla en vez de "".
  let bioInferenceTest: { bio_used: string | null; result?: string; error?: string } = { bio_used: null };
  if (contactRaw && typeof contactRaw === "object") {
    const cf = (contactRaw as any).fields ?? (contactRaw as any).vars ?? {};
    const bio = [cf.summary, cf.jobDescription, cf.companyDescription, cf.tagline].filter((v) => typeof v === "string" && v.trim()).join("\n\n");
    if (bio) {
      bioInferenceTest.bio_used = bio.slice(0, 300) + (bio.length > 300 ? "…" : "");
      try {
        bioInferenceTest.result = await inferCompanyNameFromBioRaw(bio);
      } catch (err: any) {
        bioInferenceTest.error = err?.message ?? String(err);
      }
    }
  }

  const { error: firstSeenTableError } = await db.from("lemlist_lead_first_seen").select("campaign_id").limit(1);

  return NextResponse.json({
    staging_campaign_id: stagingId,
    used_dedicated_manual_search_campaign: Boolean(config?.lemlist_manual_search_campaign_id),
    lemlist_lead_first_seen_migration_ok: !firstSeenTableError,
    lemlist_lead_first_seen_error: firstSeenTableError?.message ?? null,
    processed_leads: processed.ok ? processed.leads : { error: processed.error },
    bio_inference_test: bioInferenceTest,
    raw_config: {
      lemlist_campaign_id: config?.lemlist_campaign_id ?? null,
      lemlist_staging_campaign_id: config?.lemlist_staging_campaign_id ?? null,
      lemlist_manual_search_campaign_id: config?.lemlist_manual_search_campaign_id ?? null,
      warning_same_campaign_for_both:
        Boolean(config?.lemlist_staging_campaign_id) &&
        config?.lemlist_staging_campaign_id === config?.lemlist_manual_search_campaign_id
          ? "lemlist_staging_campaign_id y lemlist_manual_search_campaign_id apuntan a la MISMA campaña — Teléfonos y Búsqueda manual se van a seguir mezclando."
          : null,
    },
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
