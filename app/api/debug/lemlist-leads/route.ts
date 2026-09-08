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

  // Probar distintos límites en actividades para ver cuál funciona
  const [r100, r500, r1000, r5000, rNoLimit] = await Promise.all([
    fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=100`, { headers }),
    fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=500`, { headers }),
    fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=1000`, { headers }),
    fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=5000`, { headers }),
    fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}`, { headers }),
  ]);

  const parse = async (r: Response) => {
    const body = await r.json().catch(() => null);
    const items = Array.isArray(body) ? body : (body?.data ?? body?.activities ?? body?.items ?? []);
    return { status: r.status, count: items.length, first: items[0] ?? null };
  };

  return NextResponse.json({
    campaignId: camp.campaign_id,
    campaignName: camp.campaign_name,
    "limit=100":   await parse(r100),
    "limit=500":   await parse(r500),
    "limit=1000":  await parse(r1000),
    "limit=5000":  await parse(r5000),
    "sin limit":   await parse(rNoLimit),
  });
}
