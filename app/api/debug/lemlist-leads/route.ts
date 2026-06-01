import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal de debug — ver estructura real de leads de Lemlist
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Sin LEMLIST_API_KEY" }, { status: 500 });

  const db = supabaseAdmin();
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) return NextResponse.json({ error: "Sin campaña configurada" }, { status: 400 });

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const res = await fetch(
    `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads?limit=3`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  const raw = await res.json();
  // Devuelve la respuesta cruda para ver la estructura real
  return NextResponse.json({ status: res.status, raw });
}
