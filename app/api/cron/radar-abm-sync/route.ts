import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";
import { readCronStatus, recordCronStatus } from "@/lib/radarAbm/server/store";
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

const BUDGET_MS = 250_000;
// Cada cliente se lanza en su propia invocación y NO se espera a que termine
// (antes se esperaba: un cliente lento o que fallaba ocupaba la corrida entera
// y, como seguía siendo el más atrasado, volvía a ir primero en la siguiente;
// los demás nunca llegaban). Se lanza uno cada LAUNCH_GAP_MS para no saturar
// HubSpot, y los que se intentaron hace menos de RETRY_AFTER_MS van al final.
const LAUNCH_GAP_MS = 45_000;
const RETRY_AFTER_MS = 3 * 3600_000;
// Corre cada hora de 9 a 16 UTC (vercel.json): cada corrida toma solo los
// clientes que no se sincronizaron en las últimas horas, así todos quedan al
// día aunque en una sola corrida no alcancen todos. ?all=1 fuerza todos.
const FRESH_MS = 18 * 3600_000;
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
    const sub = req.nextUrl.searchParams.get("sub") || undefined;
    try {
      const r = await syncClientRadar(one, "cron", sub);
      await recordCronStatus(one, sub, { state: "ok", detail: `${r.stats.companies} empresas, ${r.stats.contacts} contactos, ${r.stats.meetings} reuniones (${r.stats.seconds} s)` });
      return NextResponse.json({ client_id: one, ok: true });
    } catch (e) {
      await recordCronStatus(one, sub, { state: "error", detail: (e as Error).message.slice(0, 400) });
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
        const reason = !c ? "cliente no encontrado" : row ? `Maestra: ${row.status || "sin status"}` : "no figura en la Maestra";
        skipped.push({ client_id: id, reason });
        if (c) await recordCronStatus(id, undefined, { state: "skipped", detail: reason });
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
    // Los intentados hace poco (ok sin snapshot nuevo, error o "started" que no
    // terminó) van al final: no bloquean a los que esperan su turno
    const attempts = await Promise.all(queue.map((q) => readCronStatus(q.id, q.sub).catch(() => null)));
    const recent = (i: number) => { const a = attempts[i]?.at; return a ? Date.now() - new Date(a).getTime() < RETRY_AFTER_MS : false; };
    const ordered = queue.map((q, i) => ({ q, late: recent(i) ? 1 : 0, i })).sort((a, b) => a.late - b.late || a.i - b.i).map((x) => x.q);

    // Lanza cada invocación y no espera su resultado: la invocación del cliente
    // corre con sus propios 5 min y deja su estado (ok / error) en el caché
    const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    for (const { id, sub } of ordered) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const url = new URL(self);
      url.searchParams.set("client_id", id);
      if (sub) url.searchParams.set("sub", sub);
      // "started": si queda así, la invocación no terminó (se pasó de los 5 min)
      await recordCronStatus(id, sub, { state: "started" });
      try {
        // Basta con que la invocación arranque: se corta la espera a los 8 s
        const r = await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store", signal: AbortSignal.timeout(8_000) });
        const j = await r.json().catch(() => ({}));
        results.push({ client_id: id, ...(sub ? { sub } : {}), ok: r.ok && !!j.ok, ...(j.error || !r.ok ? { error: j.error ?? `HTTP ${r.status}` } : {}) });
        if (!r.ok && !j.error) await recordCronStatus(id, sub, { state: "error", detail: `La sincronización automática no pudo llamar a la invocación del cliente (HTTP ${r.status}).` });
      } catch (e) {
        // Timeout esperado: la invocación sigue corriendo por su cuenta
        if ((e as Error).name !== "TimeoutError" && (e as Error).name !== "AbortError") results.push({ client_id: id, ...(sub ? { sub } : {}), ok: false, error: (e as Error).message });
        else results.push({ client_id: id, ...(sub ? { sub } : {}), ok: true, error: "lanzada" });
      }
      await new Promise((r) => setTimeout(r, LAUNCH_GAP_MS));
    }
    return NextResponse.json({ launched: results.length, pending: ordered.length - results.length, results, skipped });
  } catch (err) {
    console.error("Error en /api/cron/radar-abm-sync:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
