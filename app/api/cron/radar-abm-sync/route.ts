import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (diario, ver vercel.json): resincroniza el Radar ABM de los
// clientes que ya tienen informe (o configuración del Radar), empezando por
// el más antiguo. Solo clientes con Status Cliente = Activo en la Maestra
// (los demás se saltan). Si no alcanza el tiempo, los que quedan se toman en
// la próxima corrida. Se valida CRON_SECRET igual que el resto de /api/cron.

const BUDGET_MS = 240_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const startedAt = Date.now();
  try {
    const db = supabaseAdmin();
    const [{ data: snaps }, { data: settings }] = await Promise.all([
      db.from("radar_abm_snapshots").select("client_id, synced_at"),
      db.from("radar_abm_clients").select("client_id"),
    ]);
    const last = new Map((snaps ?? []).map((s: { client_id: string; synced_at: string }) => [s.client_id, s.synced_at]));
    const ids = Array.from(new Set([...(snaps ?? []).map((s: { client_id: string }) => s.client_id), ...(settings ?? []).map((s: { client_id: string }) => s.client_id)]));
    ids.sort((a, b) => (last.get(a) ?? "").localeCompare(last.get(b) ?? ""));

    // Solo clientes activos en la Maestra; los demás se saltan
    const masterRows = await readMasterClients(true);
    const { data: clients } = await db.from("clients").select("id, name, slug").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((clients ?? []).map((c: { id: string; name: string; slug: string | null }) => [c.id, c]));
    const skipped: { client_id: string; reason: string }[] = [];
    const results: { client_id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      const row = c ? findMasterRow(masterRows, c) : null;
      if (!row?.active) {
        skipped.push({ client_id: id, reason: !c ? "cliente no encontrado" : row ? `Maestra: ${row.status || "sin status"}` : "no figura en la Maestra" });
        continue;
      }
      if (Date.now() - startedAt > BUDGET_MS) break;
      try {
        await syncClientRadar(id, "cron");
        results.push({ client_id: id, ok: true });
      } catch (e) {
        results.push({ client_id: id, ok: false, error: (e as Error).message });
      }
    }
    return NextResponse.json({ synced: results.filter((r) => r.ok).length, pending: ids.length - results.length - skipped.length, results, skipped });
  } catch (err) {
    console.error("Error en /api/cron/radar-abm-sync:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
