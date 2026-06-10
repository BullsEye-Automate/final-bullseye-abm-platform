import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id || !body?.email) {
    return NextResponse.json({ error: "Se requiere client_id y email" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, body.client_id);
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", body.client_id)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const isPaused = body.pause !== false; // default true = pausar

  const lemRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads/${encodeURIComponent(body.email)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPaused }),
    }
  ).catch(() => null);

  if (!lemRes?.ok) {
    const txt = await lemRes?.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist ${lemRes?.status}: ${txt.slice(0, 150)}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, email: body.email, isPaused });
}
