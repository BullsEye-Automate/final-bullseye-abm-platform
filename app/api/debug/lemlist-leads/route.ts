import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal de debug — ver estructura real de leads de Lemlist
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "Sin LEMLIST_API_KEY" }, { status: 500 });

  // Mostrar qué API key se está usando (solo primeros 6 chars)
  const apiKeyHint = apiKey.slice(0, 6) + "…";

  // Obtener todas las campañas asignadas
  const { data: assigned } = await db
    .from("client_lemlist_campaigns")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("is_active", true);

  if (!assigned?.length) {
    return NextResponse.json({ error: "Sin campañas asignadas en client_lemlist_campaigns", apiKeyHint }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${credentials}` };

  // Probar primer campaña: verificar que existe + sus leads
  const firstCampaign = assigned[0];

  const [campaignRes, leadsRes] = await Promise.all([
    fetch(`https://api.lemlist.com/api/campaigns/${firstCampaign.campaign_id}`, { headers, cache: "no-store" }),
    fetch(`https://api.lemlist.com/api/campaigns/${firstCampaign.campaign_id}/leads?limit=3`, { headers, cache: "no-store" }),
  ]);

  const campaignRaw = await campaignRes.json().catch(() => null);
  const leadsRaw = await leadsRes.json().catch(() => null);

  return NextResponse.json({
    apiKeyHint,
    assignedCampaigns: assigned,
    firstCampaignId: firstCampaign.campaign_id,
    campaign: { status: campaignRes.status, raw: campaignRaw },
    leads: { status: leadsRes.status, raw: leadsRaw },
  });
}
