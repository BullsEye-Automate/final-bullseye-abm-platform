import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { demoDataset } from "@/lib/radarAbm/demo";
import { loadClientSettings, loadRadarConfig, loadSnapshot } from "@/lib/radarAbm/server/store";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Radar ABM — vista interna (Análisis → Radar ABM). Solo equipo BullsEye:
// el middleware deja fuera a los usuarios del portal (rol "client").
//   GET  ?client_id=          → última sincronización + configuración
//   GET  ?client_id=&demo=1   → datos demo del prototipo (badge "Datos demo")
//   POST ?client_id=          → sincroniza el cliente desde HubSpot ("Actualizar")

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: "Elige un cliente" }, { status: 400 });
  try {
    const { data: client } = await supabaseAdmin().from("clients").select("id, name").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const config = await loadRadarConfig();
    if (req.nextUrl.searchParams.get("demo") === "1") {
      return NextResponse.json({ dataset: demoDataset(client.name), config });
    }
    const [snapshot, settings] = await Promise.all([loadSnapshot(clientId), loadClientSettings(clientId)]);
    return NextResponse.json({
      dataset: snapshot?.dataset ?? null,
      syncedAt: snapshot?.synced_at ?? null,
      warnings: snapshot?.warnings ?? [],
      stats: snapshot?.stats ?? null,
      settings,
      config,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: "Elige un cliente" }, { status: 400 });
  try {
    const result = await syncClientRadar(clientId, await getReviewerEmail());
    return NextResponse.json(result);
  } catch (err) {
    console.error("Radar ABM: error sincronizando", clientId, err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
