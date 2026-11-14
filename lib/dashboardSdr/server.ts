import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, readAssignment, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { buildClientDirectory } from "@/lib/celulasSdr/server/clientAccounts";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";
import { loadAllDatasets, loadClientSettings, universeMode } from "@/lib/radarAbm/server/store";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { canMarkBilling, loadBillingMarks } from "./billing";
import { loadStatusOverrides, overrideId, type StatusOverride } from "./statusEdit";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { summarize } from "./compute";
import { CT_G, PAUSA } from "@/lib/radarAbm/dictionaries";
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

const VERSION = "v10";
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
  // Con informe de Pulso pero no activos en la Maestra (no entran al dashboard)
  const notActive = clients.filter((c) => withSnap.has(c.id) && !findMasterRow(masterRows, c)?.active).map((c) => c.name).sort();

  // Metas del mes: SDR × cuenta (las cuentas que comparten ID Cliente van por separado)
  const month = today.slice(0, 7);
  const rawGoals = await readAssignment(spreadsheetId, resolvePerson, [], Number(today.slice(0, 4))).catch(() => []);
  const dir = buildClientDirectory(clients, rawGoals);
  const goalBy = new Map<string, number>(); // "<sdr>|<cuenta>" → meta
  const goalPeople = new Map<string, { name: string; accounts: Map<string, string> }>(); // SDR → cuenta → nombre en Asignación
  for (const g of rawGoals) {
    if (g.month !== month || !(g.goal > 0)) continue;
    const key = resolveSdrKey(g.person);
    if (isExcludedSdr(key)) continue;
    const acc = dir.goalClientId(g.client);
    const k = `${key}|${acc}`;
    goalBy.set(k, (goalBy.get(k) ?? 0) + g.goal);
    const gp = goalPeople.get(key) ?? { name: g.person, accounts: new Map<string, string>() };
    if (!gp.accounts.has(acc)) gp.accounts.set(acc, dir.clients.get(acc)?.name ?? g.client.trim());
    goalPeople.set(key, gp);
  }

  // Célula de cada persona (líder incluida)
  const cellOf = new Map<string, string>();
  for (const c of master.cells) for (const n of [c.leader, ...c.members]) cellOf.set(resolveSdrKey(n), c.leader);
  // SDR que se muestran (pedido de BullsEye): los que tienen meta este mes en
  // la pestaña "Asignación" (manda la planilla de metas). Si el mes aún no
  // tiene metas cargadas, los activos en la Maestra ("Status Responsable" =
  // Activo; sin status, solo si está en una célula). Los demás y "Sin SDR
  // asignado" no aparecen en el selector, la vista de la célula ni el correo.
  const activeKeys = new Set<string>(goalPeople.keys());
  if (!activeKeys.size) {
    for (const p of master.people) {
      const k = resolveSdrKey(p.name);
      if (p.active === true || (p.active === null && cellOf.has(k))) activeKeys.add(k);
    }
    for (const p of master.people) if (p.active === false) activeKeys.delete(resolveSdrKey(p.name));
  }

  const slices = new Map<string, SdrSlice>();
  const clientsOf = new Map<string, Set<string>>();
  const sources: IndexCache["sources"] = [];
  const missing: string[] = [];
  // Diagnóstico: valores de SDR de HubSpot que no quedan en una SDR activa
  const unmatched = new Map<string, { client: string; raw: string; name: string; why: string; companies: number; contacts: number }>();
  let curClient = "";
  const note = (raw: string, name: string, why: string, kind: "companies" | "contacts") => {
    const k = `${curClient}|${raw}`;
    const u = unmatched.get(k) ?? { client: curClient, raw, name, why, companies: 0, contacts: 0 };
    u[kind]++;
    unmatched.set(k, u);
  };
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
    if (!x) { x = { key: s.key, name: s.name, companies: [], contacts: [], meetings: [], goals: {}, ctData: {}, accts: {} }; slices.set(s.key, x); }
    const cs = clientsOf.get(s.key) ?? new Set<string>();
    cs.add(client);
    clientsOf.set(s.key, cs);
    return x;
  };
  const meetingSince = daysBefore(today, MEETING_DAYS);
  // (activeKeys se arma arriba con la Maestra)
  const trackRaw = (raw: string | null | undefined, s: { key: string; name: string }, kind: "companies" | "contacts") => {
    const v = (raw ?? "").trim();
    if (s.key === NO_SDR_KEY) { note(v || "(vacío)", "Sin SDR asignado", "La empresa no tiene SDR en HubSpot", kind); return; }
    if (activeKeys.has(s.key)) return;
    const known = resolvePerson(v).known;
    const p = master.people.find((x) => resolveSdrKey(x.name) === s.key);
    note(v, s.name, !known ? "No calza con nadie de la Maestra" : p?.active === false ? "Inactiva en la Maestra" : "Sin status Activo en la Maestra", kind);
  };
  const accountOf = new Map<string, string>(); // nombre de la cuenta → id en Asignación

  const overrides = await loadStatusOverrides();
  const accts: SdrSlice["accts"] = {};
  let acct = 0;
  // De a uno: los informes grandes (Crossnet) pesan decenas de MB
  for (const cl of active) {
    if (!withSnap.has(cl.id)) { missing.push(cl.name); continue; }
    let sets: Awaited<ReturnType<typeof loadAllDatasets>>;
    try { sets = await loadAllDatasets(cl.id); } catch { missing.push(cl.name); continue; }
    const settings = await loadClientSettings(cl.id).catch(() => null);
    const editable = !!settings && settings.hubspot_source !== "client" && universeMode(settings, cl.name) !== "client";
    for (const { sub, dataset, syncedAt } of sets) {
      const client = sub || cl.name;
      curClient = client;
      accountOf.set(client, dir.toAccount(cl.id, sub ?? null, null) ?? cl.id);
      const pre = `a${acct++}`;
      sources.push({ client, syncedAt });
      const d = dataset.client;
      accts[client] = { id: cl.id, sub: sub ?? null, edit: editable };
      // Cambios de status hechos desde el dashboard después de la última sincronización
      const ov = (type: "company" | "contact", hsId: string | number, st: string) => {
        const o = overrides.get(overrideId(cl.id, sub ?? null, type, String(hsId)));
        return o && (!syncedAt || o.at > syncedAt) ? o.st : st;
      };
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

      // Contactos disponibles para esta cuenta: en el HubSpot de BullsEye una
      // empresa puede tener cientos de contactos de otros clientes; solo
      // cuentan los con "Cliente BullsEye" = este cliente (pedido de BullsEye).
      // Requiere un informe de Pulso sincronizado con la marca own.
      const contacts = d.ownData ? d.contacts.filter((k) => k.own) : d.contacts;
      const ctByCo = new Map<string, typeof contacts>();
      for (const k of contacts) ctByCo.set(String(k.co), [...(ctByCo.get(String(k.co)) ?? []), k]);
      const pendSt = (st: string) => CT_G[st] === "pend" || st === PAUSA;

      // Empresas por su SDR
      const coName = new Map<string, string>();
      const coSdr = new Map<string, { key: string; name: string } | null>();
      const coSdrRaw = new Map<string, string>();
      for (const co of d.companies) {
        const id = String(co.id);
        coName.set(id, co.n);
        coSdrRaw.set(id, co.sdr ?? "");
        const s = sdrOf(co.sdr);
        coSdr.set(id, s);
        if (!s) continue;
        const row: SdrCompany = {
          id: gid(id), hs: id, c: client, n: co.n || "(sin nombre)", st: ov("company", id, co.st || "Sin status"), pais: co.pais || "", ind: co.ind ?? null,
          nct: d.ownData ? (ctByCo.get(id)?.length ?? 0) : co.nct ?? 0,
          nmg: d.ownData ? (ctByCo.get(id) ?? []).filter((k) => !pendSt(k.st)).length : co.nmg ?? 0,
          msch: co.msch ?? 0, mheld: co.mheld ?? 0, asg: co.asg || "",
          ...(co.next ? { next: co.next } : {}), ...(triedCo.has(id) ? { tr: 1 as const } : {}),
        };
        const x = slice(s, client);
        x.companies.push(row);
        trackRaw(co.sdr, s, "companies");
        x.ctData[client] = ctData;
      }

      // Contactos por su SDR (si no tiene, el de su empresa)
      const ctById = new Map(d.contacts.map((k) => [String(k.id), k]));
      for (const ct of contacts) {
        const co = String(ct.co);
        const s = ct.sdr?.trim() && ct.sdr !== "Sin SDR" ? sdrOf(ct.sdr) : coSdr.get(co) ?? sdrOf("");
        if (!s) continue;
        const row: SdrContact = {
          id: gid(ct.id), hs: String(ct.id), co: gid(co), con: coName.get(co) ?? "", c: client, n: ct.n || "(sin nombre)", cargo: ct.cargo ?? "", st: ov("contact", ct.id, ct.st || "Sin status"),
          ...(ct.sen ? { sen: ct.sen } : {}), ...(ct.area ? { area: ct.area } : {}), ...(ct.next ? { next: ct.next } : {}),
          ...(triedCt.has(String(ct.id)) ? { tr: 1 as const } : {}),
          ...(ctData ? { ph: ct.ph ? 1 as const : 0 as const, ml: ct.ml ? 1 as const : 0 as const, lk: ct.lk ? 1 as const : 0 as const } : {}),
        };
        const x = slice(s, client);
        x.contacts.push(row);
        trackRaw(ct.sdr?.trim() && ct.sdr !== "Sin SDR" ? ct.sdr : coSdrRaw.get(co) ?? "", s, "contacts");
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
          id: String(m.id), ...(m.hora ? { hora: m.hora } : {}), ...(m.cargo ? { cargo: m.cargo } : {}),
          ...(m.org ? { org: m.org } : {}), ...(m.oppv ? { opp: m.oppv } : {}),
        };
        slice(s, client).meetings.push(row);
      }
    }
  }

  // Solo los clientes que el SDR trabaja = los con meta este mes en
  // Asignación (pedido de BullsEye: si HubSpot lo tiene como SDR en un cliente
  // sin meta, ese cliente no aparece en su dashboard). Sin metas en el mes no
  // se filtra. Se compara por cuenta (accountOf), no por nombre.
  for (const [key, gp] of goalPeople) {
    const sl = slices.get(key);
    if (!sl) continue;
    const ok = (c: string) => gp.accounts.has(accountOf.get(c) ?? "");
    sl.companies = sl.companies.filter((x) => ok(x.c));
    sl.contacts = sl.contacts.filter((x) => ok(x.c));
    sl.meetings = sl.meetings.filter((x) => ok(x.c));
    const cs = clientsOf.get(key);
    if (cs) for (const c of [...cs]) if (!ok(c)) cs.delete(c);
  }

  // Registro y cuenta de cada cliente de la cartera (para cambiar el status)
  for (const sl of slices.values()) for (const c of clientsOf.get(sl.key) ?? []) if (accts[c]) sl.accts[c] = accts[c];

  // Metas del mes: cada cliente con meta del SDR tiene su tarjeta, aunque en
  // Pulso no le calce ninguna empresa (nombre del cliente = el de su informe
  // de Pulso; si no tiene informe, el de la app / Asignación)
  const nameOfAccount = new Map<string, string>();
  for (const [client, acc] of accountOf) if (!nameOfAccount.has(acc)) nameOfAccount.set(acc, client);
  for (const [key, gp] of goalPeople) {
    const existing = slices.get(key);
    for (const [acc, accName] of gp.accounts) {
      const client = nameOfAccount.get(acc) ?? accName;
      const x = slice(existing ? { key, name: existing.name } : { key, name: gp.name }, client);
      x.goals[client] = goalBy.get(`${key}|${acc}`) ?? 0;
    }
  }

  const index: SdrIndexRow[] = [...slices.values()]
    .filter((s) => activeKeys.has(s.key))
    .map((s) => ({
      key: s.key, name: s.name, companies: s.companies.length, contacts: s.contacts.length,
      clients: [...(clientsOf.get(s.key) ?? [])].sort(), cell: cellOf.get(s.key) ?? null, summary: summarize(s, today),
    }))
    .sort((a, b) => (a.key === NO_SDR_KEY ? 1 : b.key === NO_SDR_KEY ? -1 : a.name.localeCompare(b.name)));
  const cells = [...new Set(master.cells.map((c) => c.leader))].sort();
  const unmatchedList = [...unmatched.values()].sort((a, b) => a.client.localeCompare(b.client) || b.companies - a.companies);
  const idx: IndexCache = { generated: new Date().toISOString(), today, index, cells, sources, missing, notActive, unmatched: unmatchedList };

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
  // Cambios de status hechos desde el dashboard después de armar la caché
  if (sdr) sdr = applyOverrides(sdr, await loadStatusOverrides(), idx.sources);
  let fcReady = false;
  if (sdr) ({ slice: sdr, fcReady } = await withMeetingNotes(sdr, canMarkBilling(opts.email)));
  return { ...idx, me: { key: meKey, name: me.sdrName ?? null, canEditAll: canEditMeetings(opts.email), canBill: canMarkBilling(opts.email) }, sdr, fcReady };
}

// Comentario de cada reunión (columna "notas" de la planilla, tabla meetings)
// y la marca «Para facturar» (allo_response_cache, lib/dashboardSdr/billing.ts),
// leídos en vivo. La marca solo se carga para quien puede verla.
async function withMeetingNotes(s: SdrSlice, withBilling: boolean): Promise<{ slice: SdrSlice; fcReady: boolean }> {
  const ids = [...new Set(s.meetings.map((m) => m.id).filter(Boolean) as string[])];
  const notes = new Map<string, string>();
  let marks = new Map<string, { value: boolean }>();
  try {
    const db = supabaseAdmin();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("meetings").select("id, notas").in("id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as { id: string; notas: string | null }[]) if (r.notas?.trim()) notes.set(String(r.id), r.notas.trim().slice(0, 800));
    }
    if (withBilling) marks = await loadBillingMarks();
  } catch (e) {
    console.error("Dashboard SDR: no se pudieron leer los comentarios / marcas de las reuniones:", e);
  }
  const meetings = s.meetings.map((m) => {
    if (!m.id) return m;
    const { fc: _old, ...rest } = m;
    return { ...rest, ...(notes.has(m.id) ? { nt: notes.get(m.id) } : {}), ...(marks.get(m.id)?.value ? { fc: 1 as const } : {}) };
  });
  return { slice: { ...s, meetings }, fcReady: true };
}

function applyOverrides(s: SdrSlice, overrides: Map<string, StatusOverride>, sources: IndexCache["sources"]): SdrSlice {
  if (!overrides.size) return s;
  const synced = new Map(sources.map((x) => [x.client, x.syncedAt]));
  const pick = (c: string, type: "company" | "contact", hs: string, st: string) => {
    const a = s.accts?.[c];
    if (!a || !hs) return st;
    const o = overrides.get(overrideId(a.id, a.sub, type, hs));
    const at = synced.get(c);
    return o && (!at || o.at > at) ? o.st : st;
  };
  return {
    ...s,
    companies: s.companies.map((c) => ({ ...c, st: pick(c.c, "company", c.hs, c.st) })),
    contacts: s.contacts.map((k) => ({ ...k, st: pick(k.c, "contact", k.hs, k.st) })),
  };
}
