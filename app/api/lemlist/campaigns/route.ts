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

  // Recopilar IDs de campaña asociados al cliente desde ambas fuentes
  const [{ data: assoc }, { data: config }] = await Promise.all([
    db.from("client_lemlist_campaigns").select("campaign_id").eq("client_id", clientId),
    db.from("client_configs").select("lemlist_campaign_id, lemlist_staging_campaign_id").eq("client_id", clientId).maybeSingle(),
  ]);

  const allowedIds = new Set<string>();
  (assoc ?? []).forEach((a) => a.campaign_id && allowedIds.add(a.campaign_id));
  if (config?.lemlist_campaign_id)         allowedIds.add(config.lemlist_campaign_id);
  if (config?.lemlist_staging_campaign_id) allowedIds.add(config.lemlist_staging_campaign_id);

  // Si no hay ninguna configurada, devolver todas (compatibilidad)
  const filtered = allowedIds.size > 0
    ? campaigns.filter((c: any) => allowedIds.has(c._id ?? c.id))
    : campaigns;

  return NextResponse.json({
    campaigns: filtered.map((c: any) => ({
      id: c._id ?? c.id,
      name: c.name,
      status: c.status ?? null,
    })),
  });
}
