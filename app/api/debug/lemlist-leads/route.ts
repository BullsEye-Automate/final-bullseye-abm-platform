import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal de debug — ver estructura real de leads y actividades de Lemlist
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
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!assigned?.campaign_id) {
    return NextResponse.json({ error: "Sin campañas asignadas en client_lemlist_campaigns" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${credentials}` };
  const cid = assigned.campaign_id;

  const [leadsRes, activityRes] = await Promise.all([
    fetch(`https://api.lemlist.com/api/campaigns/${cid}/leads?limit=2`, { headers, cache: "no-store" }),
    fetch(`https://api.lemlist.com/api/activities?type=linkedinInviteAccepted&campaignId=${cid}&limit=2`, { headers, cache: "no-store" }),
  ]);

  const leadsRaw  = await leadsRes.json().catch(() => null);
  const activityRaw = await activityRes.json().catch(() => null);

  return NextResponse.json({
    campaignId: cid,
    campaignName: assigned.campaign_name,
    leads:     { status: leadsRes.status,    sample: leadsRaw },
    activity:  { status: activityRes.status, sample: activityRaw },
  });
}
