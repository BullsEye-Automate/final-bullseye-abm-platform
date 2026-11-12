import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncClientRadar } from "@/lib/radarAbm/server/sync";
import { readCronStatus, recordCronStatus, type CronStatus } from "@/lib/radarAbm/server/store";
import { runInBackground } from "@/lib/backgroundTask";
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

const BUDGET_MS = 240_000;
// Cada cliente corre en su propia invocación (?client_id=) y la corrida
// principal la espera sin cortar la conexión. Antes cortaba la espera a los
// 8 s y Vercel terminaba la invocación del cliente: todos quedaban "started"
// sin sincronizar (nov-2026: Grupo Tress, BullsEye, Apply, Acid Labs, Simplex
// atrasados de 3 a 14 días).
// Como máximo MAX_RUNNING sincronizaciones a la vez: todas comparten el límite
// de búsquedas de HubSpot (~3 req/s) y en paralelo se pasaban de los 5 min.
// Un "started" de hace menos de RUNNING_MS cuenta como en curso; más antiguo,
// como intento que no terminó (va al final de la fila por RETRY_AFTER_MS).
const MAX_RUNNING = 2;
const RUNNING_MS = 6 * 60_000;
const POLL_MS = 20_000;
// La invocación del cliente deja "error" antes de que Vercel la corte (300 s)
const CHILD_LIMIT_MS = 285_000;
// La corrida principal espera a sus invocaciones hasta este punto (su propio
// límite también es 300 s)
const PARENT_LIMIT_MS = 296_000;
const RETRY_AFTER_MS = 3 * 3600_000;
// Corre cada 10 min de 9 a 16 UTC (vercel.json): cada corrida toma solo los
// clientes que no se sincronizaron en las últimas horas y los lanza a medida
// que se liberan cupos. ?all=1 fuerza todos.
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
    const task = syncOne(one, sub);
    // En Vercel responde de inmediato y sigue en segundo plano; fuera de
    // Vercel (local) espera el resultado
    if (runInBackground(task)) return NextResponse.json({ client_id: one, ok: true, accepted: true }, { status: 202 });
    const r = await task;
    return NextResponse.json({ client_id: one, ...r });
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
    // Estado del último intento de cada uno: "started" reciente = en curso
    const attempts = await Promise.all(queue.map((q) => readCronStatus(q.id, q.sub).catch(() => null)));
    const age = (a: CronStatus | null) => (a?.at ? Date.now() - new Date(a.at).getTime() : Infinity);
    const isRunning = (a: CronStatus | null) => a?.state === "started" && age(a) < RUNNING_MS;
    const running = new Set<string>();
    queue.forEach((q, i) => { if (isRunning(attempts[i])) running.add(keyOf(q)); });
    // Los intentados hace poco (error o "started" que no terminó) van al
    // final: no bloquean a los que esperan su turno
    const ordered = queue
      .map((q, i) => ({ q, late: age(attempts[i]) < RETRY_AFTER_MS ? 1 : 0, i }))
      .filter((x) => !running.has(keyOf(x.q)))
      .sort((a, b) => a.late - b.late || a.i - b.i)
      .map((x) => x.q);

    const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    // Lanza la invocación de un cliente y ESPERA su respuesta sin cortarla:
    // cortar la conexión termina la invocación en Vercel (nov-2026). Si la
    // invocación logra quedar en segundo plano (waitUntil) responde 202 al
    // instante; si no, responde al terminar (≤ CHILD_LIMIT_MS).
    type Outcome = "accepted" | "done";
    const launch = async ({ id, sub }: { id: string; sub?: string }): Promise<Outcome> => {
      const url = new URL(self);
      url.searchParams.set("client_id", id);
      if (sub) url.searchParams.set("sub", sub);
      await recordCronStatus(id, sub, { state: "started" });
      const base = { client_id: id, ...(sub ? { sub } : {}) };
      try {
        const wait = Math.max(5_000, PARENT_LIMIT_MS - (Date.now() - startedAt));
        const r = await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store", signal: AbortSignal.timeout(wait) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          await recordCronStatus(id, sub, { state: "error", detail: `La sincronización automática no pudo llamar a la invocación del cliente (HTTP ${r.status}).` });
          results.push({ ...base, ok: false, error: j.error ?? `HTTP ${r.status}` });
          return "done";
        }
        if (j.accepted) { results.push({ ...base, ok: true, error: "en segundo plano" }); return "accepted"; }
        results.push({ ...base, ok: !!j.ok, ...(j.error ? { error: j.error } : {}) });
        return "done";
      } catch (e) {
        results.push({ ...base, ok: false, error: `sin respuesta (${(e as Error).name})` });
        return "done";
      }
    };
    // Máx. MAX_RUNNING a la vez. Con respuesta al terminar, una corrida solo
    // alcanza para una tanda (se lanza al inicio y se espera); la siguiente
    // corrida (cada 10 min) sigue con la fila. Si las invocaciones quedan en
    // segundo plano (202), se siguen lanzando a medida que se liberan cupos.
    const pendingQ = [...ordered];
    let background = false;
    while (pendingQ.length && Date.now() - startedAt < BUDGET_MS) {
      const batch: { id: string; sub?: string }[] = [];
      if (background || Date.now() - startedAt < 30_000) {
        while (pendingQ.length && running.size + batch.length < MAX_RUNNING) batch.push(pendingQ.shift()!);
      }
      if (batch.length) {
        batch.forEach((q) => running.add(keyOf(q)));
        const outs = await Promise.all(batch.map(launch));
        outs.forEach((o, i) => { if (o === "done") running.delete(keyOf(batch[i])); else background = true; });
        if (!background) break;
      }
      if (!pendingQ.length) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
      // Libera los cupos de los que ya terminaron (ok / error) o se pasaron
      const keys = Array.from(running);
      const now = await Promise.all(keys.map((k) => { const [id, sub] = k.split("|"); return readCronStatus(id, sub || undefined).catch(() => null); }));
      keys.forEach((k, i) => { if (!isRunning(now[i])) running.delete(k); });
    }
    return NextResponse.json({ launched: results.length, running: Array.from(running), pending: ordered.length - results.length, results, skipped });
  } catch (err) {
    console.error("Error en /api/cron/radar-abm-sync:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

const keyOf = (q: { id: string; sub?: string }) => `${q.id}|${q.sub ?? ""}`;

// Sincroniza un cliente (o una cuenta) y deja el resultado en el caché. Si se
// acerca al límite de Vercel, deja "error" antes de que corten la invocación
// (si no, quedaría "started" sin explicación).
async function syncOne(id: string, sub?: string): Promise<{ ok: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), CHILD_LIMIT_MS); });
  try {
    const r = await Promise.race([syncClientRadar(id, "cron", sub), limit]);
    if (r === "timeout") {
      const detail = `La sincronización no terminó en ${Math.round(CHILD_LIMIT_MS / 1000)} s (límite de Vercel).`;
      await recordCronStatus(id, sub, { state: "error", detail });
      return { ok: false, error: detail };
    }
    await recordCronStatus(id, sub, { state: "ok", detail: `${r.stats.companies} empresas, ${r.stats.contacts} contactos, ${r.stats.meetings} reuniones (${r.stats.seconds} s)` });
    return { ok: true };
  } catch (e) {
    await recordCronStatus(id, sub, { state: "error", detail: (e as Error).message.slice(0, 400) });
    return { ok: false, error: (e as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
