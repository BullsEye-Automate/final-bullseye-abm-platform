import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";
import { loadAllDatasets } from "@/lib/radarAbm/server/store";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import type { SdrActivity, SdrCompany, SdrContact, SdrDashboardResponse, SdrIndexRow, SdrSlice } from "./types";

// Dashboard SDR: empresas y contactos asignados a cada SDR por cliente, con
// sus actividades. Lee los informes ya sincronizados de Pulso ABM de cada
// cliente activo en la Maestra (misma fuente que Devoluciones; no consulta
// HubSpot en vivo):
//  - empresa del SDR = "SDR - <cliente>" de la empresa,
//  - contacto del SDR = "SDR Asignado - <cliente>" del contacto o, si está
//    vacío, el SDR de su empresa,
//  - actividades = llamadas, correos, WhatsApp y LinkedIn registrados en
//    esas empresas / contactos (Pulso no guarda quién hizo cada actividad).
// El nombre de HubSpot ("Nico", "Vanesa"…) se resuelve contra la Maestra.
// Se calcula una vez para todos los SDR y se guarda por SDR en
// allo_response_cache (3 h): cada SDR descarga solo lo suyo.

const VERSION = "v1";
const TTL_MS = 3 * 3600_000;
const ACTIVITY_DAYS = 92;   // cubre "Últimos 90 días" y "Este mes"
export const NO_SDR_KEY = "sin-sdr";

type IndexCache = Omit<SdrDashboardResponse, "me" | "sdr">;
const keyIndex = (day: string) => `dashboard_sdr:${VERSION}:${day}:index`;
const keySdr = (day: string, sdr: string) => `dashboard_sdr:${VERSION}:${day}:sdr:${sdr}`;

let running: Promise<{ idx: IndexCache; slices: Map<string, SdrSlice> }> | null = null;

function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function buildAll(today: string) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const master = await readMaster(spreadsheetId, []);
  const resolvePerson = makePersonResolver(master.people);
  const db = supabaseAdmin();
  const { data: clientRows } = await db.from("clients").select("id, name, slug");
  const clients = (clientRows ?? []) as { id: string; name: string; slug: string | null }[];
  const masterRows = await readMasterClients();
  const active = clients.filter((c) => findMasterRow(masterRows, c)?.active).sort((a, b) => a.name.localeCompare(b.name));
  const { data: snaps } = await db.from("radar_abm_snapshots").select("client_id");
  const withSnap = new Set((snaps ?? []).map((x: { client_id: string }) => x.client_id));

  const since = daysBefore(today, ACTIVITY_DAYS);
  const slices = new Map<string, SdrSlice>();
  const clientsOf = new Map<string, Set<string>>();
  const sources: IndexCache["sources"] = [];
  const missing: string[] = [];
  const sdrOf = (raw: string | null | undefined): { key: string; name: string } | null => {
    const v = (raw ?? "").trim();
    if (!v) return { key: NO_SDR_KEY, name: "Sin SDR asignado" };
    const name = resolvePerson(v).name;
    const key = resolveSdrKey(name);
    if (isExcludedSdr(key)) return null;
    return { key, name };
  };
  const slice = (s: { key: string; name: string }, client: string): SdrSlice => {
    let x = slices.get(s.key);
    if (!x) { x = { key: s.key, name: s.name, companies: [], contacts: [], activities: [] }; slices.set(s.key, x); }
    const cs = clientsOf.get(s.key) ?? new Set<string>();
    cs.add(client);
    clientsOf.set(s.key, cs);
    return x;
  };

  let acct = 0;
  // De a uno: los informes grandes (Crossnet) pesan decenas de MB
  for (const cl of active) {
    if (!withSnap.has(cl.id)) { missing.push(cl.name); continue; }
    let sets: Awaited<ReturnType<typeof loadAllDatasets>>;
    try { sets = await loadAllDatasets(cl.id); } catch { missing.push(cl.name); continue; }
    for (const { sub, dataset, syncedAt } of sets) {
      const client = sub || cl.name;
      const pre = `a${acct++}`;
      sources.push({ client, syncedAt });
      const d = dataset.client;
      const gid = (id: string | number) => `${pre}:${id}`;

      const lastAct = new Map<string, string>();
      for (const a of d.activities ?? []) {
        const co = String(a.co);
        if (a.d && (lastAct.get(co) ?? "") < a.d) lastAct.set(co, a.d);
      }
      for (const ct of d.contacts) {
        const co = String(ct.co);
        if (ct.last && (lastAct.get(co) ?? "") < ct.last) lastAct.set(co, ct.last);
      }

      // Empresas por su SDR
      const coName = new Map<string, string>();
      const coSdr = new Map<string, { key: string; name: string } | null>();
      for (const co of d.companies) {
        const id = String(co.id);
        coName.set(id, co.n);
        const s = sdrOf(co.sdr);
        coSdr.set(id, s);
        if (!s) continue;
        const row: SdrCompany = {
          id: gid(id), c: client, n: co.n || "(sin nombre)", st: co.st || "Sin status", pais: co.pais || "", ind: co.ind ?? null,
          nct: co.nct ?? 0, nmg: co.nmg ?? 0, msch: co.msch ?? 0, mheld: co.mheld ?? 0, last: lastAct.get(id) ?? null,
        };
        slice(s, client).companies.push(row);
      }

      // Contactos por su SDR (si no tiene, el de su empresa)
      const ctSdr = new Map<string, string>();
      for (const ct of d.contacts) {
        const co = String(ct.co);
        const s = ct.sdr?.trim() ? sdrOf(ct.sdr) : coSdr.get(co) ?? sdrOf("");
        if (!s) continue;
        ctSdr.set(String(ct.id), s.key);
        slice(s, client).contacts.push({
          id: gid(ct.id), co: gid(co), con: coName.get(co) ?? "", c: client, n: ct.n || "(sin nombre)", cargo: ct.cargo ?? "", st: ct.st || "Sin status", last: ct.last ?? null,
        });
      }

      // Actividades recientes: al SDR del contacto o, sin contacto, al de la empresa
      for (const a of d.activities ?? []) {
        if (!a.d || a.d < since) continue;
        const ctKey = a.ct != null ? ctSdr.get(String(a.ct)) : undefined;
        const key = ctKey ?? coSdr.get(String(a.co))?.key;
        if (!key) continue;
        const x = slices.get(key);
        if (!x) continue;
        const act: SdrActivity = [a.d, a.k, gid(a.co), a.ct != null && ctKey ? gid(a.ct) : "", a.conn ? 1 : 0];
        x.activities.push(act);
      }
    }
  }

  const index: SdrIndexRow[] = [...slices.values()]
    .map((s) => ({ key: s.key, name: s.name, companies: s.companies.length, contacts: s.contacts.length, clients: [...(clientsOf.get(s.key) ?? [])].sort() }))
    .sort((a, b) => (a.key === NO_SDR_KEY ? 1 : b.key === NO_SDR_KEY ? -1 : a.name.localeCompare(b.name)));
  const idx: IndexCache = { generated: new Date().toISOString(), today, activitySince: since, index, sources, missing };

  await Promise.all([
    writeMonthCache(keyIndex(today), idx, TTL_MS),
    ...[...slices.values()].map((s) => writeMonthCache(keySdr(today, s.key), s, TTL_MS)),
  ]);
  return { idx, slices };
}

export async function loadSdrDashboard(opts: { sdr?: string | null; email?: string | null; fresh?: boolean }): Promise<SdrDashboardResponse> {
  const today = chileToday();
  let idx = opts.fresh ? undefined : await readMonthCache<IndexCache>(keyIndex(today));
  let built: Map<string, SdrSlice> | null = null;
  if (!idx) {
    // Varias pestañas abiertas a la vez comparten el mismo cálculo
    running = running ?? buildAll(today).finally(() => { running = null; });
    const r = await running;
    idx = r.idx;
    built = r.slices;
  }

  const me = opts.email ? await identifySdr(opts.email).catch(() => ({ sdrName: null, leaderName: null })) : { sdrName: null };
  const meKey = me.sdrName ? resolveSdrKey(me.sdrName) : null;
  const wanted = opts.sdr || (meKey && idx.index.some((r) => r.key === meKey) ? meKey : null);
  let sdr: SdrSlice | null = null;
  if (wanted) {
    sdr = built?.get(wanted) ?? (await readMonthCache<SdrSlice>(keySdr(today, wanted))) ?? null;
    if (!sdr && idx.index.some((r) => r.key === wanted)) {
      // El índice sigue vigente pero falta el detalle: se recalcula
      running = running ?? buildAll(today).finally(() => { running = null; });
      const r = await running;
      idx = r.idx;
      sdr = r.slices.get(wanted) ?? null;
    }
  }
  return { ...idx, me: { key: meKey, name: me.sdrName ?? null }, sdr };
}
