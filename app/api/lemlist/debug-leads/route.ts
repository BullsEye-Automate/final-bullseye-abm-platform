import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  const res = await fetch(
    `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads?limit=2`,
    { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
  );

  const raw = await res.json();
  const leads: any[] = Array.isArray(raw) ? raw : (raw.leads ?? raw.list ?? []);

  return NextResponse.json({
    status: res.status,
    campaign_id: config.lemlist_campaign_id,
    total_returned: leads.length,
    first_lead_keys: leads[0] ? Object.keys(leads[0]) : [],
    first_lead: leads[0] ?? null,
    second_lead: leads[1] ?? null,
  });
}
