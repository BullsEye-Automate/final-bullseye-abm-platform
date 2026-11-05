import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { demoDataset } from "@/lib/radarAbm/demo";
import { loadClientSettings, loadRadarConfig, loadSnapshot, subAccounts } from "@/lib/radarAbm/server/store";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";
import { masterStatusFor } from "@/lib/radarAbm/server/masterClients";
import { loadFeedbackOverlay } from "@/lib/radarAbm/server/sheetMeetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pulso ABM — vista interna (Análisis → Pulso ABM). Solo equipo BullsEye:
// el middleware deja fuera a los usuarios del portal (rol "client").
//   GET  ?client_id=          → última sincronización + configuración
//   GET  ?client_id=&demo=1   → datos demo del prototipo (badge "Datos demo")
//   POST ?client_id=          → sincroniza el cliente desde HubSpot ("Actualizar")

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: "Elige un cliente" }, { status: 400 });
  try {
    const { data: client } = await supabaseAdmin().from("clients").select("id, name, slug").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const config = await loadRadarConfig();
    if (req.nextUrl.searchParams.get("demo") === "1") {
      return NextResponse.json({ dataset: demoDataset(client.name), config });
    }
    const settings0 = await loadClientSettings(clientId);
    const [snapshot, settings, master, feedback] = await Promise.all([
      loadSnapshot(clientId, "url"), Promise.resolve(settings0), masterStatusFor(client),
      // Feedback del cliente en vivo (no espera al próximo sync)
      loadFeedbackOverlay(clientId, subAccounts(settings0)).catch(() => ({})),
    ]);
    return NextResponse.json({
      dataset: snapshot?.dataset ?? null,
      feedback,
      // Informe grande en Storage: lo descarga el navegador (avisos y mapeo van aparte)
      ...(snapshot?.datasetUrl ? { datasetUrl: snapshot.datasetUrl, datasetExtra: { warnings: snapshot.warnings ?? [], mapping: snapshot.mapping } } : {}),
      // Varios clientes en la cuenta: un informe por cada uno (selector interno)
      ...(snapshot?.subs?.length ? { subs: snapshot.subs } : {}),
      syncedAt: snapshot?.synced_at ?? null,
      warnings: snapshot?.warnings ?? [],
      stats: snapshot?.stats ?? null,
      settings,
      master,
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
    const sub = req.nextUrl.searchParams.get("sub")?.trim() || undefined;
    // Varios clientes en la cuenta: el navegador sincroniza uno por llamada
    if (!sub) {
      const subs = subAccounts(await loadClientSettings(clientId));
      if (subs.length) return NextResponse.json({ needsSubs: subs }, { status: 409 });
    }
    const result = await syncClientRadar(clientId, await getReviewerEmail(), sub);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Pulso ABM: error sincronizando", clientId, err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
