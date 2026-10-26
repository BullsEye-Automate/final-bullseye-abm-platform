import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (diario, ver vercel.json): resincroniza el Radar ABM de los
// clientes que ya tienen informe (o configuración del Radar), empezando por
// el más antiguo. Si no alcanza el tiempo, los que quedan se toman en la
// próxima corrida. Se valida CRON_SECRET igual que el resto de /api/cron.

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

    const results: { client_id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      try {
        await syncClientRadar(id, "cron");
        results.push({ client_id: id, ok: true });
      } catch (e) {
        results.push({ client_id: id, ok: false, error: (e as Error).message });
      }
    }
    return NextResponse.json({ synced: results.filter((r) => r.ok).length, pending: ids.length - results.length, results });
  } catch (err) {
    console.error("Error en /api/cron/radar-abm-sync:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
