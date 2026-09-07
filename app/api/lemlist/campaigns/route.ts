import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista todas las campañas de Lemlist disponibles para un cliente
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "Sin LEMLIST_API_KEY" }, { status: 500 });

  const creds = Buffer.from(`:${apiKey}`).toString("base64");
  const res = await fetch("https://api.lemlist.com/api/campaigns", {
    headers: { Authorization: `Basic ${creds}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Lemlist respondió ${res.status}` }, { status: 502 });
  }

  const raw = await res.json();
  const campaigns: any[] = Array.isArray(raw) ? raw : (raw.campaigns ?? raw.data ?? []);

  return NextResponse.json({
    campaigns: campaigns.map((c: any) => ({
      id: c._id ?? c.id,
      name: c.name,
      status: c.status ?? null,
    })),
  });
}
