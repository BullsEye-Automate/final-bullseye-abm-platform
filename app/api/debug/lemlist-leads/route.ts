import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!assigned?.length) return NextResponse.json({ error: "Sin campañas asignadas" }, { status: 400 });

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${credentials}` };
  const camp = assigned[0];

  // Probar varios endpoints posibles para estadísticas nativas
  const endpoints = [
    `/api/campaigns/${camp.campaign_id}/stats`,
    `/api/campaigns/${camp.campaign_id}/analytics`,
    `/api/campaigns/${camp.campaign_id}/leads?limit=5&offset=0`,
    `/api/activities?campaignId=${camp.campaign_id}&limit=3`,
  ];

  const results: Record<string, any> = {};
  for (const ep of endpoints) {
    const res = await fetch(`https://api.lemlist.com${ep}`, { headers, cache: "no-store" });
    const body = await res.json().catch(() => null);
    results[ep] = { status: res.status, body };
  }

  return NextResponse.json({ campaignId: camp.campaign_id, campaignName: camp.campaign_name, results });
}
