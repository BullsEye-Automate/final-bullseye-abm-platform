import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint de debug — busca una campaña con actividades y muestra la estructura real
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

  // Buscar la primera campaña que tenga actividades de emailsOpened
  let sampleActivity: any = null;
  let sampleCampaignId = "";
  for (const camp of assigned) {
    const res = await fetch(
      `https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=2`,
      { headers, cache: "no-store" }
    );
    const data = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data) ? data : (data?.data ?? data?.activities ?? data?.items ?? []);
    if (items.length > 0) {
      sampleActivity = items[0];
      sampleCampaignId = camp.campaign_id;
      break;
    }
  }

  return NextResponse.json({
    totalCampaigns: assigned.length,
    campaignWithActivity: sampleCampaignId || null,
    // Muestra todos los campos de una actividad real
    activitySample: sampleActivity,
    activityFields: sampleActivity ? Object.keys(sampleActivity) : [],
  });
}
