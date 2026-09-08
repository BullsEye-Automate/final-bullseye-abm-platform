import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Para cada campaña, contar actividades por tipo
  const summary = await Promise.all(assigned.map(async (camp: any) => {
    const [opens, replied, liAccepted, liReplied, leads] = await Promise.all([
      fetch(`https://api.lemlist.com/api/activities?type=emailsOpened&campaignId=${camp.campaign_id}&limit=500`, { headers })
        .then(r => r.json()).then(d => (Array.isArray(d) ? d : d?.items ?? []).length).catch(() => -1),
      fetch(`https://api.lemlist.com/api/activities?type=emailsReplied&campaignId=${camp.campaign_id}&limit=500`, { headers })
        .then(r => r.json()).then(d => (Array.isArray(d) ? d : d?.items ?? []).length).catch(() => -1),
      fetch(`https://api.lemlist.com/api/activities?type=linkedinInviteAccepted&campaignId=${camp.campaign_id}&limit=500`, { headers })
        .then(r => r.json()).then(d => (Array.isArray(d) ? d : d?.items ?? []).length).catch(() => -1),
      fetch(`https://api.lemlist.com/api/activities?type=linkedinReplied&campaignId=${camp.campaign_id}&limit=500`, { headers })
        .then(r => r.json()).then(d => (Array.isArray(d) ? d : d?.items ?? []).length).catch(() => -1),
      fetch(`https://api.lemlist.com/api/campaigns/${camp.campaign_id}/leads?limit=1&offset=0`, { headers })
        .then(r => r.json()).then(d => (Array.isArray(d) ? d : d?.items ?? [])[0]?._id ? "ok" : "?").catch(() => "err"),
    ]);
    return { name: camp.campaign_name, id: camp.campaign_id, opens, replied, liAccepted, liReplied, leads };
  }));

  const withActivity = summary.filter(c => c.opens > 0 || c.replied > 0 || c.liAccepted > 0 || c.liReplied > 0);
  const zeros = summary.filter(c => c.opens === 0 && c.replied === 0 && c.liAccepted === 0 && c.liReplied === 0);

  return NextResponse.json({
    total: assigned.length,
    withActivity,
    zerosCount: zeros.length,
    zeroNames: zeros.map((c: any) => c.name),
  });
}
