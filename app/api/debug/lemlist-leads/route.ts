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

  // Usar primera campaña de la nueva tabla
  const { data: assigned } = await db
    .from("client_lemlist_campaigns")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!assigned?.campaign_id) return NextResponse.json({ error: "Sin campañas asignadas en client_lemlist_campaigns" }, { status: 400 });

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const res = await fetch(
    `https://api.lemlist.com/api/campaigns/${assigned.campaign_id}/leads?limit=3`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  const raw = await res.json();
  // Devuelve la respuesta cruda para ver la estructura real
  return NextResponse.json({ status: res.status, campaignId: assigned.campaign_id, campaignName: assigned.campaign_name, raw });
}
