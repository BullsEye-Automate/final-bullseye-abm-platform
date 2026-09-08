import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint de debug — muestra la estructura real del objeto campaña y sus stats nativas
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "Sin LEMLIST_API_KEY" }, { status: 500 });

  const { data: assigned } = await db
    .from("client_lemlist_campaigns")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("is_active", true);

  if (!assigned?.length) {
    return NextResponse.json({ error: "Sin campañas asignadas" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${credentials}` };

  // Fetch primera campaña para ver su estructura
  const firstCamp = assigned[0];
  const [campaignRes, reportsRes] = await Promise.all([
    fetch(`https://api.lemlist.com/api/campaigns/${firstCamp.campaign_id}`, { headers, cache: "no-store" }),
    fetch(`https://api.lemlist.com/api/campaigns/${firstCamp.campaign_id}/reports`, { headers, cache: "no-store" }),
  ]);

  const campaignData = await campaignRes.json().catch(() => null);
  const reportsData  = await reportsRes.json().catch(() => null);

  return NextResponse.json({
    campaignId:     firstCamp.campaign_id,
    campaignName:   firstCamp.campaign_name,
    campaignStatus: campaignRes.status,
    reportsStatus:  reportsRes.status,
    // Estructura completa del objeto campaña
    campaignSample: campaignData,
    campaignFields: campaignData ? Object.keys(campaignData) : [],
    // Estructura del endpoint /reports
    reportsSample:  reportsData,
    reportsFields:  reportsData && typeof reportsData === "object" ? Object.keys(reportsData) : [],
  });
}
