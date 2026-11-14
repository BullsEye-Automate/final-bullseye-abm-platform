import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, readAssignment, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { buildClientDirectory } from "@/lib/celulasSdr/server/clientAccounts";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";
import { loadAllDatasets } from "@/lib/radarAbm/server/store";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { summarize } from "./compute";
import type { SdrCompany, SdrContact, SdrDashboardResponse, SdrIndexRow, SdrMeeting, SdrSlice } from "./types";

// Dashboard SDR: cartera de cada SDR por cliente (empresas, contactos,
// reuniones y meta del mes). Lee los informes ya sincronizados de Pulso ABM
// de cada cliente activo en la Maestra (misma fuente que Devoluciones; no
// consulta HubSpot en vivo):
//  - empresa del SDR = "SDR - <cliente>" de la empresa,
//  - contacto del SDR = "SDR Asignado - <cliente>" del contacto o, si está
//    vacío, el SDR de su empresa,
//  - reunión del SDR = "Responsable de la reunión" de la planilla,
//  - meta = pestaña "Asignación" (SDR × cliente × mes).
// Por ahora no suma actividades (decisión de BullsEye, nov-2026); solo se usa
// si una empresa o contacto tuvo algún llamado (devoluciones "sin intentos").
// El nombre de HubSpot ("Nico", "Vanesa"…) se resuelve contra la Maestra.
// Se calcula una vez para todos los SDR y se guarda por SDR en
// allo_response_cache (3 h): cada SDR descarga solo lo suyo; el índice lleva
// el resumen de cada SDR para la vista de la líder.

const VERSION = "v4";
const TTL_MS = 3 * 3600_000;
const MEETING_DAYS = 150; // reuniones con fecha o agendamiento desde hace ~5 meses
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

export async function buildAll(today: string) {
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

  // Metas del mes: SDR × cuenta (las cuentas que comparten ID Cliente van por separado)
  const month = today.slice(0, 7);
  const rawGoals = await readAssignment(spreadsheetId, resolvePerson, [], Number(today.slice(0, 4))).catch(() => []);
  const dir = buildClientDirectory(clients, rawGoals);
  const goalBy = new Map<string, number>(); // "<sdr>|<cuenta>" → meta
  for (const g of rawGoals) {
    if (g.month !== month) continue;
    const k = `${resolveSdrKey(g.person)}|${dir.goalClientId(g.client)}`;
    goalBy.set(k, (goalBy.get(k) ?? 0) + g.goal);
  }

  // Célula de cada persona (líder incluida)
  const cellOf = new Map<string, string>();
  for (const c of master.cells) for (const n of [c.leader, ...c.members]) cellOf.set(resolveSdrKey(n), c.leader);

  const slices = new Map<string, SdrSlice>();
  const clientsOf = new Map<string, Set<string>>();
  const sources: IndexCache["sources"] = [];
  const missing: string[] = [];
  const sdrOf = (raw: string | null | undefined): { key: string; name: string } | null => {
    const v = (raw ?? "").trim();
    if (!v || v === "Sin SDR") return { key: NO_SDR_KEY, name: "Sin SDR asignado" };
    const name = resolvePerson(v).name;
    const key = resolveSdrKey(name);
    if (isExcludedSdr(key)) return null;
    return { key, name };
  };
  const slice = (s: { key: string; name: string }, client: string): SdrSlice => {
    let x = slices.get(s.key);
    if (!x) { x = { key: s.key, name: s.name, companies: [], contacts: [], meetings: [], goals: {}, ctData: {} }; slices.set(s.key, x); }
    const cs = clientsOf.get(s.key) ?? new Set<string>();
    cs.add(client);
    clientsOf.set(s.key, cs);
    return x;
  };
  const meetingSince = daysBefore(today, MEETING_DAYS);
  const accountOf = new Map<string, string>(); // nombre de la cuenta → id en Asignación

  let acct = 0;
  // De a uno: los informes grandes (Crossnet) pesan decenas de MB
  for (const cl of active) {
    if (!withSnap.has(cl.id)) { missing.push(cl.name); continue; }
    let sets: Awaited<ReturnType<typeof loadAllDatasets>>;
    try { sets = await loadAllDatasets(cl.id); } catch { missing.push(cl.name); continue; }
    for (const { sub, dataset, syncedAt } of sets) {
      const client = sub || cl.name;
      accountOf.set(client, dir.toAccount(cl.id, sub ?? null, null) ?? cl.id);
      const pre = `a${acct++}`;
      sources.push({ client, syncedAt });
      const d = dataset.client;
      const gid = (id: string | number) => `${pre}:${id}`;
      const ctData = !!d.ctData;

      // Empresas y contactos con algún llamado
      const triedCo = new Set<string>();
      const triedCt = new Set<string>();
      for (const a of d.activities ?? []) {
        if (a.k !== "call") continue;
        triedCo.add(String(a.co));
        if (a.ct != null) triedCt.add(String(a.ct));
      }
      for (const k of d.contacts) if ((k.att ?? k.calls ?? 0) > 0) { triedCt.add(String(k.id)); triedCo.add(String(k.co)); }

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
          nct: co.nct ?? 0, nmg: co.nmg ?? 0, msch: co.msch ?? 0, mheld: co.mheld ?? 0, asg: co.asg || "",
          ...(co.next ? { next: co.next } : {}), ...(triedCo.has(id) ? { tr: 1 as const } : {}),
        };
        const x = slice(s, client);
        x.companies.push(row);
        x.ctData[client] = ctData;
      }

      // Contactos por su SDR (si no tiene, el de su empresa)
      const ctById = new Map(d.contacts.map((k) => [String(k.id), k]));
      for (const ct of d.contacts) {
        const co = String(ct.co);
        const s = ct.sdr?.trim() && ct.sdr !== "Sin SDR" ? sdrOf(ct.sdr) : coSdr.get(co) ?? sdrOf("");
        if (!s) continue;
        const row: SdrContact = {
          id: gid(ct.id), co: gid(co), con: coName.get(co) ?? "", c: client, n: ct.n || "(sin nombre)", cargo: ct.cargo ?? "", st: ct.st || "Sin status",
          ...(ct.sen ? { sen: ct.sen } : {}), ...(ct.area ? { area: ct.area } : {}), ...(ct.next ? { next: ct.next } : {}),
          ...(triedCt.has(String(ct.id)) ? { tr: 1 as const } : {}),
          ...(ctData ? { ph: ct.ph ? 1 as const : 0 as const, ml: ct.ml ? 1 as const : 0 as const, lk: ct.lk ? 1 as const : 0 as const } : {}),
        };
        const x = slice(s, client);
        x.contacts.push(row);
        x.ctData[client] = ctData;
      }

      // Reuniones de la planilla por su responsable
      for (const m of d.meetings ?? []) {
        if ((m.fecha || "") < meetingSince && (m.agendada || "") < meetingSince) continue;
        const s = sdrOf(m.sdr);
        if (!s || s.key === NO_SDR_KEY) continue;
        const coId = String(m.co ?? "");
        const matched = !!coId && !coId.startsWith("nc:") && coName.has(coId);
        const k = m.ct != null ? ctById.get(String(m.ct)) : undefined;
        const row: SdrMeeting = {
          c: client, co: matched ? gid(coId) : "", con: (matched ? coName.get(coId) : m.emp) || m.emp || "",
          ctn: k?.n || m.ctn || "", ...(k?.sen ? { sen: k.sen } : {}), ...(k?.area ? { area: k.area } : {}),
          ag: m.agendada || "", f: m.fecha || "", st: m.st || "",
        };
        slice(s, client).meetings.push(row);
      }
    }
  }

  // Metas del mes en cada cartera
  for (const s of slices.values()) {
    for (const client of clientsOf.get(s.key) ?? []) {
      const g = goalBy.get(`${s.key}|${accountOf.get(client)}`);
      if (g) s.goals[client] = g;
    }
  }

  const index: SdrIndexRow[] = [...slices.values()]
    .map((s) => ({
      key: s.key, name: s.name, companies: s.companies.length, contacts: s.contacts.length,
      clients: [...(clientsOf.get(s.key) ?? [])].sort(), cell: cellOf.get(s.key) ?? null, summary: summarize(s, today),
    }))
    .sort((a, b) => (a.key === NO_SDR_KEY ? 1 : b.key === NO_SDR_KEY ? -1 : a.name.localeCompare(b.name)));
  const cells = [...new Set(master.cells.map((c) => c.leader))].sort();
  const idx: IndexCache = { generated: new Date().toISOString(), today, index, cells, sources, missing };

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
