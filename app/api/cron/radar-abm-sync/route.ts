import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";
import { parseSubs } from "@/lib/radarAbm/subAccounts";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (diario, ver vercel.json): resincroniza el Pulso ABM de los
// clientes que ya tienen informe (o configuración del Radar), empezando por
// el más antiguo. Solo clientes con Status Cliente = Activo en la Maestra
// (los demás se saltan). Si no alcanza el tiempo, los que quedan se toman en
// la próxima corrida. Se valida CRON_SECRET igual que el resto de /api/cron.
// Cada cliente corre en su propia invocación (?client_id=, con sus 5 min):
// un cliente grande (ej. Crossnet) no deja sin sincronizar a los demás.

const BUDGET_MS = 270_000;
// Corre cada hora de 9 a 16 UTC (vercel.json): cada corrida toma solo los
// clientes que no se sincronizaron en las últimas horas, así todos quedan al
// día aunque en una sola corrida no alcancen todos. ?all=1 fuerza todos.
const FRESH_MS = 18 * 3600_000;
const PARALLEL = 2; // HubSpot comparte el límite de requests entre clientes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const startedAt = Date.now();
  // Un solo cliente (lo llama la corrida principal)
  const one = req.nextUrl.searchParams.get("client_id");
  if (one) {
    if (!UUID_RE.test(one)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
    try {
      await syncClientRadar(one, "cron", req.nextUrl.searchParams.get("sub") || undefined);
      return NextResponse.json({ client_id: one, ok: true });
    } catch (e) {
      return NextResponse.json({ client_id: one, ok: false, error: (e as Error).message });
    }
  }
  const all = req.nextUrl.searchParams.get("all") === "1";
  try {
    const db = supabaseAdmin();
    const [{ data: snaps }, { data: settings }] = await Promise.all([
      db.from("radar_abm_snapshots").select("client_id, synced_at"),
      db.from("radar_abm_clients").select("client_id, properties"),
    ]);
    const last = new Map((snaps ?? []).map((s: { client_id: string; synced_at: string }) => [s.client_id, s.synced_at]));
    const ids = Array.from(new Set([...(snaps ?? []).map((s: { client_id: string }) => s.client_id), ...(settings ?? []).map((s: { client_id: string }) => s.client_id)]));
    ids.sort((a, b) => (last.get(a) ?? "").localeCompare(last.get(b) ?? ""));

    // Solo clientes activos en la Maestra; los demás se saltan
    const masterRows = await readMasterClients(true);
    const { data: clients } = await db.from("clients").select("id, name, slug").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((clients ?? []).map((c: { id: string; name: string; slug: string | null }) => [c.id, c]));
    const skipped: { client_id: string; reason: string }[] = [];
    // Varios clientes en la cuenta: una invocación por cada uno
    const subsOf = new Map((settings ?? []).map((s: { client_id: string; properties?: Record<string, string> | null }) => [s.client_id, parseSubs(s.properties?.subAccounts)]));
    const results: { client_id: string; sub?: string; ok: boolean; error?: string }[] = [];
    const queue: { id: string; sub?: string }[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      const row = c ? findMasterRow(masterRows, c) : null;
      if (!row?.active) {
        skipped.push({ client_id: id, reason: !c ? "cliente no encontrado" : row ? `Maestra: ${row.status || "sin status"}` : "no figura en la Maestra" });
        continue;
      }
      const syncedAt = last.get(id);
      if (!all && syncedAt && Date.now() - new Date(syncedAt).getTime() < FRESH_MS) {
        skipped.push({ client_id: id, reason: "ya sincronizado hoy" });
        continue;
      }
      const subs = subsOf.get(id) ?? [];
      if (subs.length) for (const sub of subs) queue.push({ id, sub });
      else queue.push({ id });
    }
    // Si esta corrida se acaba, las invocaciones ya lanzadas siguen hasta terminar
    const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (next < queue.length && Date.now() - startedAt < BUDGET_MS) {
        const { id, sub } = queue[next++];
        try {
          const url = new URL(self);
          url.searchParams.set("client_id", id);
          if (sub) url.searchParams.set("sub", sub);
          const r = await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          results.push({ client_id: id, ...(sub ? { sub } : {}), ok: r.ok && !!j.ok, ...(j.error || !r.ok ? { error: j.error ?? `HTTP ${r.status}` } : {}) });
        } catch (e) {
          results.push({ client_id: id, ...(sub ? { sub } : {}), ok: false, error: (e as Error).message });
        }
      }
    }));
    return NextResponse.json({ synced: results.filter((r) => r.ok).length, pending: queue.length - results.length, results, skipped });
  } catch (err) {
    console.error("Error en /api/cron/radar-abm-sync:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
