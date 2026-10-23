// Motor de cálculo del módulo Células SDR. Es la versión tipada de las
// funciones agg / derive / forecast / buildAlerts del prototipo HTML
// (Dashboard-SDR-BullsEye.html), alimentada con los datos reales:
// - metas: pestaña Asignación (meta interna, SDR × cliente × mes)
// - reuniones: pestaña API Reuniones (tabla meetings)
// - llamadas, contactados y score: Allo
// - correo / WhatsApp / LinkedIn: HubSpot (sin cliente)
// Sin dependencias de React: se puede probar con datos de la planilla.
import { SCORE_CARD_CATEGORIES } from "@/lib/callScoreCard";
import {
  addDays, businessDaysBetween, businessDaysInMonth, dayKey, isBusinessDay, monthEnd, monthOf,
  monthStart, parseDay, shiftMonth, weekLabel, weekShort, weekStart,
} from "./calendar";
import type {
  AlloMonthResponse, BaseResponse, CallDay, CallEval, CellLeader, CellsConfig, ChannelDay, Client,
  Goal, HubspotMonthResponse, Meeting, Sdr,
} from "./types";

// ─── formato (chileno: 1.234 y 61,3%) ───────────────────────────────────────
export const ok = (v: number | null | undefined): v is number => v != null && isFinite(v);
export const fmt = (n: number | null | undefined, d = 0) =>
  ok(n) ? Number(n).toLocaleString("es-CL", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";
export const pct = (n: number | null | undefined, d = 0) => (ok(n) ? fmt(n * 100, d) + "%" : "—");
export const sgn = (n: number | null | undefined, d = 0) => (ok(n) ? (n > 0 ? "+" : "") + fmt(n, d) : "—");
export const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  ok(a) && ok(b) && b > 0 ? a / b : null;
export const c01 = (v: number | null | undefined) => Math.max(0, Math.min(1, v || 0));

// ─── colores (adaptados a la app) ───────────────────────────────────────────
export const COLORS = {
  primary: "#3D2878",
  brandSoft: "#7F77DD",
  teal: "#14A39A",
  sky: "#2F80ED",
  violet: "#7F77DD",
  magenta: "#E0457B",
  orange: "#F08A3E",
  g: "#1F9D74",
  y: "#D99A1E",
  r: "#D0583A",
  n: "#9794AC",
  text: "#1A1733",
  border: "#ECEAF4",
};
export type Sem = "g" | "y" | "r" | "n";
export const SEMI: Record<Sem, string> = { g: "🟢", y: "🟡", r: "🔴", n: "⚪" };
export const SEMT: Record<Sem, string> = { g: "Sobre meta", y: "En riesgo", r: "Bajo meta", n: "Sin datos" };
export const semColor = (s: Sem) => COLORS[s];

// ─── criterios de calidad (pauta de Allo) ───────────────────────────────────
export const QCRIT = SCORE_CARD_CATEGORIES.map((c) => ({
  n: c.label,
  s: c.label
    .replace("Apertura y Contexto", "Apertura")
    .replace("Permiso y Engagement", "Permiso")
    .replace("Discovery y Contexto", "Discovery")
    .replace("Escucha Activa y Conversación", "Escucha")
    .replace("Propuesta de Valor y Relevancia", "Propuesta")
    .replace("Manejo de Objeciones", "Objeciones")
    .replace("Cierre y Siguiente Paso", "Cierre")
    .replace("Calidad de Comunicación", "Comunicación"),
}));
export type QBand = "g" | "y" | "r";
export const QBN: Record<QBand, string> = { g: "Buena", y: "Regular", r: "Deficiente" };

// ─── tipos del modelo ───────────────────────────────────────────────────────
export type Filters = { leader: string; sdr: string; client: string; country: string };
// leader: clave del líder (su célula), "__leaders" (líderes con meta propia) o "__none" (sin célula)
export const LEADERS_GROUP = "__leaders";
export const NO_CELL = "__none";

export type Period = {
  dates: Set<string>;   // días calendario incluidos (para sumar eventos)
  bdays: string[];      // días hábiles incluidos (para metas y promedios)
  fullGoal: boolean;    // usar la meta completa del mes (base "Meta del mes")
  // Último día del período completo (fin de mes / domingo), aunque `dates`
  // corte en hoy: las reuniones se cuentan por FECHA DE LA REUNIÓN dentro
  // del período completo, así que las pendientes de lo que queda del mes
  // también son del mes (confirmado con BullsEye).
  fullEnd?: string;
};

export type Agg = {
  calls: number; contacted: number;
  emails: number | null; wa: number | null; li: number | null; other: number | null;
  sched: number; held: number; noshow: number; resch: number; pending: number; pastPending: number; opps: number;
  goal: number; sdrDays: number; nd: number;
  // Actividad de quienes tienen meta diaria de llamadas/actividades (todos
  // menos los líderes de célula, que no tienen meta diaria — confirmado con
  // BullsEye). Las llamadas de los líderes sí suman a calls/emails/etc.
  mtgTotal: number;     // reuniones con fecha de reunión en el período completo (cualquier estado)
  callDays: number; callsQ: number; emailsQ: number; waQ: number; liQ: number; actsQ: number | null;
  cl: Record<string, { calls: number; contacted: number; sched: number; held: number; noshow: number; resch: number; opps: number; goal: number; pending: number }>;
  qN: number; qSum: number; qcSum: number[]; qcN: number[]; qb: Record<QBand, number>;
  chUnavailable: boolean;
  // derivados
  acts: number | null; callGoal: number; actGoal: number;
  compl: number | null; due: number; attend: number | null; nsRate: number | null; concr: number | null;
  conn: number | null; c2m: number | null; m2o: number | null; callPct: number | null; actPct: number | null;
  schedGoal: number; oppGoal: number; contGoal: number; wcompl: number | null;
  callsPerDay: number | null; actsPerDay: number | null; mtgPerDay: number | null; heldPerDay: number | null;
  cp100: number | null; mp100: number | null; op100: number | null;
  qScore: number | null; qCrit: (number | null)[]; qHi: number | null; qLo: number | null; qPct: number | null;
};

export type Week = { mon: string; label: string; short: string; days: string[] };

export type Model = {
  cfg: CellsConfig;
  today: string;
  months: string[];
  leaders: CellLeader[];
  LD: Record<string, CellLeader>;
  sdrs: (Sdr & { nodata: boolean })[];
  SD: Record<string, Sdr & { nodata: boolean }>;
  clients: Client[];
  CL: Record<string, Client & { country: string | null; weight: number; baseWeight: number }>;
  countries: string[];
  days: string[];               // días hábiles cargados, hasta hoy
  weeks: Week[];
  goals: Goal[];
  meetings: Meeting[];
  calls: CallDay[];
  evals: CallEval[];
  channels: ChannelDay[];
  hsClients: Set<string>;       // clientes con HubSpot propio conectado
  alloMonths: Set<string>;
  hubspotMonths: Set<string>;
  // índices para el reparto de SDR-días con filtro de cliente/país
  sdrMonth: Map<string, { goal: number; goalBy: Map<string, number>; calls: number; callsBy: Map<string, number>; callsByCountry: Map<string, number> }>;
  callsBySdrDay: Map<string, number>;
  incomplete: BaseResponse["incomplete"];
};

// ─── construcción del modelo ────────────────────────────────────────────────
const EXTRA_PALETTE = ["#64748B", "#A16207", "#0F766E", "#9D174D", "#4338CA", "#15803D"];

function initialsOf(name: string) {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

// Personas que no forman parte de la reportería de Células SDR (confirmado
// con BullsEye): no aparecen en ninguna vista y sus metas, reuniones,
// llamadas y actividades no suman a ningún total. Se compara contra la clave
// normalizada (sin tildes, minúsculas), por nombre de pila para cubrir las
// variantes de Allo / HubSpot / planilla.
const EXCLUDED_PEOPLE = ["adolfo", "jose pablo"];
export function isExcludedSdr(key: string): boolean {
  return EXCLUDED_PEOPLE.some((x) => key === x || key.startsWith(`${x} `));
}

export function buildModel(
  rawBase: BaseResponse,
  allo: Record<string, AlloMonthResponse>,
  hubspot: Record<string, HubspotMonthResponse>,
  cfg: CellsConfig
): Model {
  const keep = (k: string) => !isExcludedSdr(k);
  const base: BaseResponse = {
    ...rawBase,
    sdrs: rawBase.sdrs.filter((s) => keep(s.key)),
    goals: rawBase.goals.filter((g) => keep(g.sdr)),
    meetings: rawBase.meetings.filter((m) => keep(m.sdr)),
  };
  const today = base.today;
  const months = base.months;
  const loadedAllo = months.filter((m) => allo[m]);
  const loadedHs = months.filter((m) => hubspot[m]);
  const calls = loadedAllo.flatMap((m) => allo[m].calls).filter((c) => keep(c.s));
  const evals = loadedAllo.flatMap((m) => allo[m].evals).filter((e) => keep(e.s));
  const channels = loadedHs.flatMap((m) => hubspot[m].channels).filter((h) => keep(h.s));
  const hsClients = new Set(loadedHs.flatMap((m) => hubspot[m].connectedClients ?? []));

  // SDR: roster base + quienes solo aparecen en Allo (llamadas). Los
  // usuarios de HubSpot que no son SDR del roster no se agregan: solo suman
  // correo/WhatsApp/LinkedIn a SDR que ya existen.
  const sdrMap = new Map<string, Sdr>(base.sdrs.map((s) => [s.key, s]));
  let extra = 0;
  for (const m of loadedAllo) {
    for (const [key, name] of Object.entries(allo[m].sdrNames)) {
      if (sdrMap.has(key) || !keep(key)) continue;
      sdrMap.set(key, {
        key, name, short: name.split(" ")[0], initials: initialsOf(name), group: "none", leaderKey: null,
        active: null, color: EXTRA_PALETTE[extra++ % EXTRA_PALETTE.length],
      });
    }
  }
  const hasData = new Set<string>();
  base.goals.forEach((g) => hasData.add(g.sdr));
  base.meetings.forEach((x) => hasData.add(x.sdr));
  calls.forEach((c) => hasData.add(c.s));
  const sdrs = [...sdrMap.values()].map((s) => ({ ...s, nodata: !hasData.has(s.key) }));
  const SD = Object.fromEntries(sdrs.map((s) => [s.key, s]));
  const LD = Object.fromEntries(base.leaders.map((l) => [l.key, l]));

  // País de cada cliente (para filtrar metas por país): el más frecuente en
  // sus reuniones; si no tiene reuniones, el de sus llamadas.
  const countryVotes = new Map<string, Map<string, number>>();
  const vote = (c: string | null, k: string | null, w: number) => {
    if (!c || !k) return;
    const m = countryVotes.get(c) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + w);
    countryVotes.set(c, m);
  };
  base.meetings.forEach((x) => vote(x.client, x.country, 1000));
  calls.forEach((x) => vote(x.c, x.k, x.calls));
  const top = (m?: Map<string, number>) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null);

  // Peso por cliente: el configurado, o proporcional a su meta (del último
  // mes cargado con metas).
  const lastGoalMonth = [...months].reverse().find((m) => base.goals.some((g) => g.month === m && m <= today.slice(0, 7))) ?? months[months.length - 1];
  const goalByClient = new Map<string, number>();
  base.goals.filter((g) => g.month === lastGoalMonth).forEach((g) => goalByClient.set(g.client, (goalByClient.get(g.client) ?? 0) + g.goal));
  const totalGoal = [...goalByClient.values()].reduce((a, b) => a + b, 0);
  const CL: Model["CL"] = {};
  for (const c of base.clients) {
    const baseWeight = totalGoal ? Math.round(((goalByClient.get(c.id) ?? 0) / totalGoal) * 1000) / 10 : 0;
    const w = cfg.clientWeights[c.id];
    CL[c.id] = { ...c, country: top(countryVotes.get(c.id)), baseWeight, weight: ok(w) ? w : baseWeight };
  }
  const countries = [...new Set([...base.meetings.map((m) => m.country), ...calls.map((c) => c.k)].filter((x): x is string => !!x && x !== "Sin país"))].sort((a, b) => a.localeCompare(b, "es"));

  // Calendario cargado (días hábiles hasta hoy) y semanas
  const lastDay = monthEnd(months[months.length - 1]);
  const days = businessDaysBetween(monthStart(months[0]), lastDay < today ? lastDay : today);
  const weeks: Week[] = [];
  for (const d of days) {
    const mon = weekStart(d);
    let w = weeks[weeks.length - 1];
    if (!w || w.mon !== mon) {
      w = { mon, label: weekLabel(mon), short: weekShort(mon), days: [] };
      weeks.push(w);
    }
    w.days.push(d);
  }

  const sdrMonth: Model["sdrMonth"] = new Map();
  const sm = (s: string, m: string) => {
    const k = `${s}|${m}`;
    let v = sdrMonth.get(k);
    if (!v) {
      v = { goal: 0, goalBy: new Map(), calls: 0, callsBy: new Map(), callsByCountry: new Map() };
      sdrMonth.set(k, v);
    }
    return v;
  };
  for (const g of base.goals) {
    const v = sm(g.sdr, g.month);
    v.goal += g.goal;
    v.goalBy.set(g.client, (v.goalBy.get(g.client) ?? 0) + g.goal);
  }
  const callsBySdrDay = new Map<string, number>();
  for (const c of calls) {
    const v = sm(c.s, monthOf(c.d));
    v.calls += c.calls;
    if (c.c) v.callsBy.set(c.c, (v.callsBy.get(c.c) ?? 0) + c.calls);
    v.callsByCountry.set(c.k, (v.callsByCountry.get(c.k) ?? 0) + c.calls);
    const k = `${c.s}|${c.d}`;
    callsBySdrDay.set(k, (callsBySdrDay.get(k) ?? 0) + c.calls);
  }

  return {
    cfg, today, months, leaders: base.leaders, LD, sdrs, SD, clients: base.clients, CL, countries, days, weeks,
    goals: base.goals, meetings: base.meetings, calls, evals, channels, hsClients,
    alloMonths: new Set(loadedAllo), hubspotMonths: new Set(loadedHs), sdrMonth, callsBySdrDay,
    incomplete: base.incomplete,
  };
}

// ─── filtros ────────────────────────────────────────────────────────────────
export type FL = {
  f: Filters;
  sdrOk: (s: string) => boolean;
  cOk: (client: string | null, country: string | null) => boolean;
  goalOk: (client: string) => boolean;
  clientScoped: boolean;
};

export function makeFilter(M: Model, f: Filters): FL {
  const sdrOk = (s: string) => {
    if (f.sdr && s !== f.sdr) return false;
    if (!f.leader) return true;
    const x = M.SD[s];
    if (f.leader === LEADERS_GROUP) return x?.group === "leader";
    if (f.leader === NO_CELL) return !x || x.group === "none";
    return x?.leaderKey === f.leader;
  };
  const cOk = (client: string | null, country: string | null) =>
    (!f.client || client === f.client) && (!f.country || country === f.country);
  const goalOk = (client: string) => (!f.client || client === f.client) && (!f.country || M.CL[client]?.country === f.country);
  return { f, sdrOk, cOk, goalOk, clientScoped: !!(f.client || f.country) };
}

// ─── períodos ───────────────────────────────────────────────────────────────
function datesBetween(from: string, to: string): Set<string> {
  const s = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) s.add(d);
  return s;
}
export function periodFromRange(from: string, to: string, fullGoal = false): Period {
  return { dates: datesBetween(from, to), bdays: businessDaysBetween(from, to), fullGoal };
}
export function periodFromDays(bdays: string[]): Period {
  return { dates: new Set(bdays), bdays, fullGoal: false };
}

export type PType = "mes" | "sem" | "dia";

export function currentPeriod(M: Model, ptype: PType, pval: string): Period {
  if (ptype === "mes") {
    const end = monthEnd(pval);
    return { ...periodFromRange(monthStart(pval), end < M.today ? end : M.today, M.cfg.goalBase === "mes"), fullEnd: end };
  }
  if (ptype === "sem") {
    const sun = addDays(pval, 6);
    return { ...periodFromRange(pval, sun < M.today ? sun : M.today), fullEnd: sun };
  }
  return periodFromRange(pval, pval);
}

// Mismo corte del período anterior: mes a la fecha vs los mismos días
// hábiles del mes anterior, semana vs semana anterior, día vs día hábil anterior.
export function previousPeriod(M: Model, ptype: PType, pval: string): Period | null {
  if (ptype === "mes") {
    const cur = currentPeriod(M, ptype, pval);
    const pm = shiftMonth(pval, -1);
    if (!M.months.includes(pm)) return null;
    const pb = businessDaysBetween(monthStart(pm), monthEnd(pm));
    const n = Math.min(cur.bdays.length, pb.length);
    if (!n) return null;
    const lastB = pb[n - 1];
    const to = n === pb.length ? monthEnd(pm) : lastB;
    return periodFromRange(monthStart(pm), to, M.cfg.goalBase === "mes");
  }
  if (ptype === "sem") {
    const mon = addDays(pval, -7);
    if (mon < monthStart(M.months[0])) return null;
    return periodFromRange(mon, addDays(mon, 6));
  }
  let d = addDays(pval, -1);
  while (!isBusinessDay(d)) d = addDays(d, -1);
  if (d < monthStart(M.months[0])) return null;
  return periodFromRange(d, d);
}

export function prevLabel(ptype: PType) {
  return ptype === "mes" ? "vs mismo corte del mes anterior" : ptype === "sem" ? "vs semana anterior" : "vs día hábil anterior";
}

// ─── agregación ─────────────────────────────────────────────────────────────
function fracFor(M: Model, fl: FL, s: string, m: string): number {
  if (!fl.clientScoped) return 1;
  const v = M.sdrMonth.get(`${s}|${m}`);
  if (!v) return 0;
  if (v.goal > 0) {
    let g = 0;
    v.goalBy.forEach((x, c) => { if (fl.goalOk(c)) g += x; });
    return g / v.goal;
  }
  if (v.calls > 0) {
    return fl.f.client
      ? (v.callsBy.get(fl.f.client) ?? 0) / v.calls
      : (v.callsByCountry.get(fl.f.country) ?? 0) / v.calls;
  }
  return 0;
}

export function qBand(M: Model, v: number): QBand {
  return v >= M.cfg.qGood ? "g" : v >= M.cfg.qReg ? "y" : "r";
}
export const qColor = (b: QBand) => (b === "g" ? COLORS.g : b === "y" ? COLORS.y : COLORS.r);

const isLeaderKey = (M: Model, s: string) => M.SD[s]?.group === "leader";

export function agg(M: Model, P: Period, fl: FL): Agg {
  const cfg = M.cfg;
  const inD = P.dates;
  const nC = QCRIT.length;
  // filtro solo de cliente (sin país) sobre un cliente con HubSpot propio
  const chClient = fl.f.client && !fl.f.country && M.hsClients.has(fl.f.client) ? fl.f.client : null;
  const r: Agg = {
    calls: 0, contacted: 0, emails: 0, wa: 0, li: 0, other: null,
    sched: 0, held: 0, noshow: 0, resch: 0, pending: 0, pastPending: 0, opps: 0,
    goal: 0, sdrDays: 0, nd: P.bdays.length, cl: {},
    mtgTotal: 0, callDays: 0, callsQ: 0, emailsQ: 0, waQ: 0, liQ: 0, actsQ: null,
    qN: 0, qSum: 0, qcSum: new Array(nC).fill(0), qcN: new Array(nC).fill(0), qb: { g: 0, y: 0, r: 0 },
    // con filtro de cliente, los canales de HubSpot solo se pueden mostrar si
    // el cliente tiene su HubSpot conectado (sus actividades traen cliente)
    chUnavailable: fl.clientScoped && !chClient,
  } as Agg;
  const cl = (id: string | null) => {
    const k = id ?? "__none";
    return r.cl[k] || (r.cl[k] = { calls: 0, contacted: 0, sched: 0, held: 0, noshow: 0, resch: 0, opps: 0, goal: 0, pending: 0 });
  };

  for (const a of M.calls) {
    if (!inD.has(a.d) || !fl.sdrOk(a.s) || !fl.cOk(a.c, a.k)) continue;
    r.calls += a.calls;
    r.contacted += a.contacted;
    if (!isLeaderKey(M, a.s)) r.callsQ += a.calls;
    const c = cl(a.c);
    c.calls += a.calls;
    c.contacted += a.contacted;
  }
  if (!fl.clientScoped || chClient) {
    for (const h of M.channels) {
      if (!inD.has(h.d) || !fl.sdrOk(h.s)) continue;
      if (chClient && h.c !== chClient) continue;
      r.emails! += h.email;
      r.wa! += h.wa;
      r.li! += h.li;
      if (!isLeaderKey(M, h.s)) {
        r.emailsQ += h.email;
        r.waQ += h.wa;
        r.liQ += h.li;
      }
    }
  } else {
    r.emails = r.wa = r.li = null;
  }

  const oppSet = new Set(cfg.oppValues);
  const sortedDates = [...inD].sort();
  const pStart = sortedDates[0] ?? M.today, pEnd = sortedDates[sortedDates.length - 1] ?? M.today;
  const horizon = P.fullEnd && P.fullEnd > pEnd ? P.fullEnd : pEnd;
  for (const m of M.meetings) {
    if (!fl.sdrOk(m.sdr) || !fl.cOk(m.client, m.country)) continue;
    if (m.sd && inD.has(m.sd)) {
      r.sched++;
      cl(m.client).sched++;
    }
    // Reuniones del período = todas las con FECHA DE LA REUNIÓN en el período
    // completo (cualquier estado), como se cuentan en API Reuniones.
    // Pendientes = las de ese conjunto con Realizado "Pendiente".
    const inHorizon = !!m.md && m.md >= pStart && m.md <= horizon;
    if (inHorizon) r.mtgTotal++;
    if (m.st === "pending" && (m.md ? inHorizon : !!m.sd && inD.has(m.sd))) {
      r.pending++;
      cl(m.client).pending++;
    }
    if (m.md && inD.has(m.md)) {
      const c = cl(m.client);
      if (m.st === "held") {
        r.held++;
        c.held++;
        if (oppSet.has(m.opp)) {
          r.opps++;
          c.opps++;
        }
      } else if (m.st === "noshow") {
        r.noshow++;
        c.noshow++;
      } else if (m.st === "resch") {
        r.resch++;
        c.resch++;
      } else if (m.md < M.today) {
        r.pastPending++;
      }
    }
  }

  for (const e of M.evals) {
    if (!inD.has(e.d) || !fl.sdrOk(e.s) || !fl.cOk(e.c, e.k)) continue;
    r.qN++;
    r.qSum += e.score;
    e.crit.forEach((v, i) => {
      if (ok(v)) {
        r.qcSum[i] += v;
        r.qcN[i]++;
      }
    });
    r.qb[qBand(M, e.score)]++;
  }

  // Meta: la meta mensual de cada SDR × cliente se reparte por día hábil
  // (o, con base "Meta del mes", se toma completa).
  const nm: Record<string, number> = {};
  if (P.fullGoal) P.bdays.forEach((d) => (nm[monthOf(d)] = (nm[monthOf(d)] ?? 0) + 1));
  const goalsBy = new Map<string, Goal[]>();
  for (const g of M.goals) {
    if (!fl.sdrOk(g.sdr) || !fl.goalOk(g.client)) continue;
    const l = goalsBy.get(g.month) ?? [];
    l.push(g);
    goalsBy.set(g.month, l);
  }
  const activeBy = new Map<string, string[]>();
  const activeIn = (m: string) => {
    let l = activeBy.get(m);
    if (!l) {
      l = M.sdrs.filter((s) => {
        if (s.nodata || !fl.sdrOk(s.key)) return false;
        const v = M.sdrMonth.get(`${s.key}|${m}`);
        return !!v && (v.goal > 0 || v.calls > 0);
      }).map((s) => s.key);
      activeBy.set(m, l);
    }
    return l;
  };
  const sdBy = new Map<string, number>();
  const cdBy = new Map<string, number>();
  for (const d of P.bdays) {
    const m = monthOf(d);
    const wd = P.fullGoal ? nm[m] : businessDaysInMonth(m);
    for (const g of goalsBy.get(m) ?? []) {
      const x = g.goal / wd;
      r.goal += x;
      cl(g.client).goal += x;
    }
    let sd = sdBy.get(m);
    if (sd === undefined) {
      sd = activeIn(m).reduce((acc, s) => acc + fracFor(M, fl, s, m), 0);
      sdBy.set(m, sd);
    }
    r.sdrDays += sd;
    let cd = cdBy.get(m);
    if (cd === undefined) {
      cd = activeIn(m).filter((s) => !isLeaderKey(M, s)).reduce((acc, s) => acc + fracFor(M, fl, s, m), 0);
      cdBy.set(m, cd);
    }
    r.callDays += cd;
  }
  return derive(M, r);
}

function derive(M: Model, r: Agg): Agg {
  const cfg = M.cfg;
  r.acts = r.chUnavailable ? null : r.calls + (r.emails ?? 0) + (r.wa ?? 0) + (r.li ?? 0);
  r.actsQ = r.chUnavailable ? null : r.callsQ + r.emailsQ + r.waQ + r.liQ;
  r.callGoal = r.callDays * cfg.callGoal;
  r.actGoal = r.callDays * cfg.actGoal;
  r.compl = div(r.held, r.goal);
  r.due = r.held + r.noshow + r.resch;
  r.attend = div(r.held, r.held + r.noshow);
  r.nsRate = div(r.noshow, r.held + r.noshow);
  r.concr = div(r.held, r.due);
  r.conn = div(r.contacted, r.calls);
  r.c2m = div(r.sched, r.contacted);
  r.m2o = div(r.opps, r.held);
  r.callPct = div(r.callsQ, r.callGoal);
  r.actPct = div(r.actsQ, r.actGoal);
  r.schedGoal = r.goal / cfg.attendTarget;
  r.oppGoal = r.goal * cfg.oppTarget;
  r.contGoal = r.callGoal * cfg.connectTarget;
  let ws = 0, wv = 0;
  for (const [id, c] of Object.entries(r.cl)) {
    if (c.goal > 0 && M.CL[id]) {
      const w = M.CL[id].weight;
      ws += w;
      wv += w * Math.min(c.held / c.goal, cfg.cap);
    }
  }
  r.wcompl = ws ? wv / ws : null;
  r.callsPerDay = div(r.callsQ, r.callDays);
  r.actsPerDay = div(r.actsQ, r.callDays);
  r.mtgPerDay = div(r.sched, r.sdrDays);
  r.heldPerDay = div(r.held, r.sdrDays);
  r.cp100 = div(r.contacted * 100, r.calls);
  r.mp100 = div(r.sched * 100, r.calls);
  r.op100 = div(r.opps * 100, r.held);
  r.qScore = div(r.qSum, r.qN);
  r.qCrit = r.qcSum.map((v, i) => div(v, r.qcN[i]));
  r.qHi = div(r.qb.g, r.qN);
  r.qLo = div(r.qb.r, r.qN);
  r.qPct = div(r.qScore, cfg.qTarget);
  return r;
}

export function sem(M: Model, v: number | null | undefined): Sem {
  return !ok(v) ? "n" : v >= M.cfg.green ? "g" : v >= M.cfg.yellow ? "y" : "r";
}
export function qSt(M: Model, v: number | null | undefined): Sem {
  return !ok(v) ? "n" : qBand(M, v);
}

// Meta completa de un mes con el filtro aplicado.
export function monthGoal(M: Model, fl: FL, m: string): number {
  return M.goals.filter((g) => g.month === m && fl.sdrOk(g.sdr) && fl.goalOk(g.client)).reduce((a, g) => a + g.goal, 0);
}

export type Forecast = {
  m: string; a: Agg; goalM: number; actual: number; elapsed: number; remaining: number; total: number;
  avg: number; proj: number; need: number; ratio: number | null; st: Sem; pending: number; oppProj: number;
};
export const FC_TXT: Record<Sem, string> = { g: "Cumplimiento proyectado", y: "En riesgo, cerca de la meta", r: "Meta en riesgo alto", n: "Sin meta asignada" };

export function forecast(M: Model, fl: FL, endDate: string): Forecast {
  const m = monthOf(endDate);
  const allB = businessDaysBetween(monthStart(m), monthEnd(m));
  const mDays = allB.filter((d) => d <= endDate);
  const total = allB.length, elapsed = mDays.length, remaining = total - elapsed;
  const a = agg(M, { ...periodFromRange(monthStart(m), endDate, true), fullEnd: monthEnd(m) }, fl);
  const goalM = monthGoal(M, fl, m);
  const avg = div(a.held, elapsed) ?? 0;
  const proj = a.held + avg * remaining;
  const need = remaining > 0 ? Math.max(0, goalM - a.held) / remaining : 0;
  const ratio = div(proj, goalM);
  const st: Sem = !ok(ratio) ? "n" : ratio >= 1 ? "g" : ratio >= M.cfg.green ? "y" : "r";
  return { m, a, goalM, actual: a.held, elapsed, remaining, total, avg, proj, need, ratio, st, pending: a.pending, oppProj: (div(a.opps, elapsed) ?? 0) * total };
}

// ─── series ─────────────────────────────────────────────────────────────────
export function endOf(P: Period): string {
  return P.bdays[P.bdays.length - 1] ?? [...P.dates].sort().pop()!;
}
export function lastWeeks(M: Model, end: string, n: number): Week[] {
  const i = M.weeks.findIndex((w) => w.mon === weekStart(end));
  const e = i === -1 ? M.weeks.length - 1 : i;
  return M.weeks.slice(Math.max(0, e - n + 1), e + 1);
}
export function weekPeriod(M: Model, w: Week): Period {
  const sun = addDays(w.mon, 6);
  return periodFromRange(w.mon, sun < M.today ? sun : M.today);
}
export function trendDays(M: Model, P: Period): string[] {
  if (P.bdays.length >= 5) return P.bdays;
  const e = endOf(P);
  const i = M.days.indexOf(e);
  return M.days.slice(Math.max(0, i - 9), i + 1);
}
export function callStreak(M: Model, s: string, end: string): number {
  const x = M.SD[s];
  if (!x || x.nodata || x.group === "leader" || !M.alloMonths.has(monthOf(end))) return 0;
  // Solo cuenta días desde la primera llamada cargada del SDR: un SDR sin
  // ninguna llamada en Allo no tiene "racha", tiene su propia alerta.
  const first = M.days.findIndex((d) => (M.callsBySdrDay.get(`${s}|${d}`) ?? 0) > 0);
  if (first === -1) return 0;
  let n = 0;
  for (let i = M.days.indexOf(end); i >= first; i--) {
    if ((M.callsBySdrDay.get(`${s}|${M.days[i]}`) ?? 0) < M.cfg.callGoal) n++;
    else break;
  }
  return n;
}
export function slopeRel(vals: number[]): number {
  const n = vals.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / n;
  if (!my) return 0;
  let nu = 0, de = 0;
  vals.forEach((v, i) => { nu += (i - mx) * (v - my); de += (i - mx) ** 2; });
  return nu / de / my;
}

// ─── filas por SDR / cliente ────────────────────────────────────────────────
export type SdrRow = { s: Model["sdrs"][number]; a: Agg; b: Agg | null; gr: number | null; rank?: number };

export function sdrList(M: Model, f: Filters) {
  const fl = makeFilter(M, { ...f, client: "", country: "" });
  return M.sdrs.filter((s) => fl.sdrOk(s.key));
}
export function sdrFilter(M: Model, f: Filters, s: string): FL {
  return makeFilter(M, { ...f, sdr: s, leader: "" });
}
export function sdrRows(M: Model, f: Filters, P: Period, Pp: Period | null): SdrRow[] {
  return sdrList(M, f).map((s) => {
    const fl = sdrFilter(M, f, s.key);
    const a = agg(M, P, fl);
    const b = Pp ? agg(M, Pp, fl) : null;
    return { s, a, b, gr: b && b.held ? (a.held - b.held) / b.held : null };
  });
}

export type ClientRow = { c: Model["CL"][string]; a: Agg; int: number | null; status: Sem | "none"; hiLo: boolean; contrib: number | null };

export function clientRows(M: Model, f: Filters, P: Period): ClientRow[] {
  const fl = makeFilter(M, f);
  const months = new Set([...P.dates].map(monthOf));
  const ids = new Set<string>();
  M.goals.forEach((g) => { if (months.has(g.month) && fl.sdrOk(g.sdr) && fl.goalOk(g.client)) ids.add(g.client); });
  M.meetings.forEach((m) => {
    if (m.client && fl.sdrOk(m.sdr) && fl.cOk(m.client, m.country) && ((m.md && P.dates.has(m.md)) || (m.sd && P.dates.has(m.sd)))) ids.add(m.client);
  });
  const rows = [...ids].filter((id) => M.CL[id]).map((id) => ({ c: M.CL[id], a: agg(M, P, makeFilter(M, { ...f, client: id })) }));
  const tg = rows.reduce((x, r) => x + r.a.goal, 0), tc = rows.reduce((x, r) => x + r.a.calls, 0);
  const avgInt = div(tc, tg);
  return rows.map((r) => {
    const int = div(r.a.calls, r.a.goal);
    const status: ClientRow["status"] = r.a.goal <= 0 ? "n" : r.a.calls === 0 && r.a.sched === 0 && r.a.held === 0 ? "none" : sem(M, r.a.compl);
    const hiLo = status !== "none" && status !== "n" && ok(int) && ok(avgInt) && int >= avgInt * 1.25 && (r.a.compl ?? 0) < M.cfg.green;
    const contrib = r.a.goal > 0 ? Math.min(r.a.compl || 0, M.cfg.cap) : null;
    return { ...r, int, status, hiLo, contrib };
  });
}

export function leaderLabel(M: Model, s: Sdr): string {
  if (s.group === "leader") return "Líder";
  if (s.leaderKey && M.LD[s.leaderKey]) return M.LD[s.leaderKey].short;
  return "Sin célula";
}
export function leaderColor(M: Model, s: Sdr): string {
  if (s.group === "leader") return M.LD[s.key]?.color ?? COLORS.n;
  if (s.leaderKey && M.LD[s.leaderKey]) return M.LD[s.leaderKey].color;
  return COLORS.n;
}

// ─── alertas ────────────────────────────────────────────────────────────────
export type Alert = { lvl: "r" | "y" | "g"; score: number; cat: string; sdr?: string; client?: string; text: string; hint: string };

export function buildAlerts(M: Model, f: Filters, P: Period): Alert[] {
  const cfg = M.cfg;
  const fl = makeFilter(M, f);
  const team = agg(M, P, fl);
  const end = endOf(P);
  const out: Alert[] = [];
  const hasAllo = [...P.dates].some((d) => M.alloMonths.has(monthOf(d)));

  for (const { s, a } of sdrRows(M, f, P, null)) {
    if (s.nodata) continue;
    const c = a.compl, st = callStreak(M, s.key, end);
    const L = leaderLabel(M, s);
    const team_ = s.group === "cell" ? `Equipo ${L}.` : s.group === "leader" ? "Líder de célula (meta propia)." : "Sin célula.";
    if (ok(c)) {
      if (c < cfg.yellow) out.push({ lvl: "r", score: 100 + (cfg.yellow - c) * 100, cat: "Cumplimiento", sdr: s.key, text: `**${s.name}** está al **${pct(c)}** de cumplimiento${st >= 2 ? ` y lleva **${st} días** bajo la meta de llamadas` : ""}.`, hint: `${team_} ${fmt(a.held)} realizadas vs ${fmt(a.goal, 1)} esperadas.` });
      else if (c < cfg.green) out.push({ lvl: "y", score: 50 + (cfg.green - c) * 100, cat: "Cumplimiento", sdr: s.key, text: `**${s.name}** está en zona amarilla con **${pct(c)}**; necesita ${fmt(Math.max(1, Math.ceil(a.goal * cfg.green - a.held)))} reuniones más para llegar al ${pct(cfg.green)}.`, hint: team_ });
      else out.push({ lvl: "g", score: 10 + c * 10, cat: "Cumplimiento", sdr: s.key, text: `**${s.name}** supera el ${pct(cfg.green)} de cumplimiento (${pct(c)}).`, hint: team_ });
    }
    if (ok(a.nsRate) && a.held + a.noshow >= 4 && a.nsRate > cfg.noshowMax) out.push({ lvl: "r", score: 80 + (a.nsRate - cfg.noshowMax) * 200, cat: "No-show", sdr: s.key, text: `**${s.name}** tiene **${pct(a.nsRate)}** de no-show (límite ${pct(cfg.noshowMax)}): ${a.noshow} reuniones perdidas.`, hint: "Revisar confirmación 24 h antes y calidad del agendamiento." });
    if (hasAllo && ok(a.conn) && a.calls > 0 && a.conn < cfg.connectMin) out.push({ lvl: "r", score: 70 + (cfg.connectMin - a.conn) * 300, cat: "Conexión", sdr: s.key, text: `**${s.name}** tiene baja tasa de conexión: **${pct(a.conn, 1)}** (mínimo ${pct(cfg.connectMin)}).`, hint: "Revisar horarios de llamada y calidad de la base." });
    if (hasAllo && a.calls === 0 && a.callDays > 0) out.push({ lvl: "r", score: 74, cat: "Actividad", sdr: s.key, text: `**${s.name}** no registra llamadas en Allo en el período.`, hint: "Si sí está llamando, revisar que su usuario de Allo calce con su nombre en la planilla." });
    else if (hasAllo && ok(a.callPct) && a.callPct < 0.9) out.push({ lvl: "r", score: 72 + (0.9 - a.callPct) * 100, cat: "Actividad", sdr: s.key, text: `**${s.name}** promedia **${fmt(a.callsPerDay)}** llamadas diarias vs meta de ${cfg.callGoal}${st >= 2 ? `, con ${st} días seguidos bajo meta` : ""}.`, hint: `${pct(a.callPct)} de la meta de llamadas del período.` });
    else if (hasAllo && st >= 3) out.push({ lvl: "y", score: 60 + st, cat: "Actividad", sdr: s.key, text: `**${s.name}** lleva **${st} días** seguidos bajo la meta de ${cfg.callGoal} llamadas.`, hint: "Caída reciente de actividad." });
    if (ok(a.m2o) && a.held >= 3 && ok(team.m2o) && a.m2o >= team.m2o * 1.25) out.push({ lvl: "g", score: 40 + a.m2o * 50, cat: "Conversión", sdr: s.key, text: `**${s.name}** tiene alta conversión reunión → oportunidad: **${pct(a.m2o)}** vs ${pct(team.m2o)} del equipo.`, hint: "Buena práctica para replicar en el equipo." });
    if (ok(a.qScore) && a.qN >= 4) {
      const wi = a.qCrit.map((v, i) => ({ v, i })).filter((x) => ok(x.v)).sort((x, y) => x.v! - y.v!)[0];
      const qw = lastWeeks(M, end, 4).map((w) => agg(M, weekPeriod(M, w), sdrFilter(M, f, s.key)).qScore).filter(ok);
      const qs = qw.length > 1 ? qw[qw.length - 1] - qw[0] : 0;
      const tr = qw.length > 1 ? ` Semana a semana: ${qw.map((v) => fmt(v)).join(" → ")}.` : "";
      const weak = wi ? ` Criterio más débil: **${QCRIT[wi.i].s.toLowerCase()}** (${fmt(wi.v, 1)}/5).` : "";
      if (a.qScore < cfg.qReg) out.push({ lvl: "r", score: 78 + (cfg.qTarget - a.qScore) * 2, cat: "Calidad", sdr: s.key, text: `**${s.name}** tiene un puntaje de llamadas de **${fmt(a.qScore)}** (${QBN[qBand(M, a.qScore)].toLowerCase()}), meta ${cfg.qTarget}.${weak}`, hint: `${fmt(a.qN)} llamadas evaluadas.${tr} Agendar coaching con escucha de llamadas.` });
      else if (a.qScore < cfg.qTarget) out.push({ lvl: "y", score: 52 + (cfg.qTarget - a.qScore) * 2, cat: "Calidad", sdr: s.key, text: `**${s.name}** está bajo la meta de calidad: **${fmt(a.qScore)}** pts vs ${cfg.qTarget}.${weak}`, hint: `${fmt(a.qN)} llamadas evaluadas.${tr}` });
      else if (qs <= -6) out.push({ lvl: "y", score: 50 + Math.abs(qs), cat: "Calidad", sdr: s.key, text: `**${s.name}** baja su puntaje de llamadas ${fmt(Math.abs(qs))} pts en las últimas semanas.`, hint: tr.trim() });
      else if (a.qScore >= cfg.qTarget + 10) out.push({ lvl: "g", score: 35 + a.qScore / 10, cat: "Calidad", sdr: s.key, text: `**${s.name}** tiene calidad de llamadas excelente: **${fmt(a.qScore)}** pts.`, hint: "Usar sus llamadas como ejemplo en el coaching del equipo." });
    }
    const ws = lastWeeks(M, end, 6).map((w) => agg(M, weekPeriod(M, w), sdrFilter(M, f, s.key)).held);
    const sl = slopeRel(ws);
    const wsum = ws.reduce((x, y) => x + y, 0);
    if (sl > 0.07 && ws[ws.length - 1] >= ws[0] && ws[ws.length - 1] >= 2 && wsum >= 6) out.push({ lvl: "g", score: 30 + sl * 100, cat: "Crecimiento", sdr: s.key, text: `**${s.name}** muestra crecimiento sostenido: reuniones realizadas por semana ${ws.slice(-4).join(" → ")}.`, hint: "Tendencia de las últimas 6 semanas." });
    else if (sl < -0.09 && wsum >= 6) out.push({ lvl: "y", score: 55 + Math.abs(sl) * 100, cat: "Tendencia", sdr: s.key, text: `**${s.name}** viene cayendo: reuniones realizadas por semana ${ws.slice(-4).join(" → ")}.`, hint: "Tendencia de las últimas 6 semanas." });
    if (a.pastPending > 0) out.push({ lvl: "y", score: 58 + a.pastPending, cat: "Registro incompleto", sdr: s.key, text: `**${s.name}** tiene **${a.pastPending}** ${a.pastPending === 1 ? "reunión pasada" : "reuniones pasadas"} con Realizado = "Pendiente".`, hint: "Actualizar la columna Realizado (Si / No / Reagendar) en la planilla." });
  }

  for (const r of clientRows(M, f, P)) {
    const n = r.c.name;
    if (r.status === "n") continue;
    if (r.status === "none") out.push({ lvl: "r", score: 95, cat: "Cliente", client: r.c.id, text: `Cliente **${n}** no registra actividad en el período (meta de ${fmt(r.a.goal, 1)} reuniones).`, hint: "Asignar SDR o activar la campaña." });
    else if ((r.a.compl ?? 0) < cfg.yellow) out.push({ lvl: "r", score: 88 + (cfg.yellow - (r.a.compl ?? 0)) * 80, cat: "Cliente", client: r.c.id, text: `Cliente **${n}** tiene **${pct(r.a.compl)}** de cumplimiento y genera menos reuniones que el ritmo esperado (${fmt(r.a.held)} vs ${fmt(r.a.goal, 1)}).`, hint: `Peso ${fmt(r.c.weight, 1)}% en el cumplimiento ponderado.` });
    else if ((r.a.compl ?? 0) < cfg.green) out.push({ lvl: "y", score: 45 + (cfg.green - (r.a.compl ?? 0)) * 80, cat: "Cliente", client: r.c.id, text: `Cliente **${n}** está en riesgo con **${pct(r.a.compl)}** de cumplimiento.`, hint: `Peso ${fmt(r.c.weight, 1)}%.` });
    if (r.hiLo) out.push({ lvl: "y", score: 65, cat: "Cliente", client: r.c.id, text: `Cliente **${n}** recibe alta actividad pero bajo resultado: ${fmt(r.a.calls)} llamadas para ${fmt(r.a.held)} reuniones realizadas.`, hint: "Revisar mensaje, segmentación o lista de cuentas." });
  }

  if (M.incomplete.invalidDates > 0 && !f.sdr && !f.client) {
    out.push({ lvl: "y", score: 57, cat: "Registro incompleto", text: `Hay **${fmt(M.incomplete.invalidDates)}** reuniones en la planilla sin una "Fecha de la reunión" válida.`, hint: "No se pueden contar en ningún período hasta corregir la fecha en API Reuniones." });
  }
  return out.sort((x, y) => y.score - x.score);
}

export function attention(al: Alert[]): Alert[] {
  const crit = al.filter((a) => a.lvl !== "g").slice(0, 4);
  const pos = al.filter((a) => a.lvl === "g" && (a.cat === "Conversión" || a.cat === "Crecimiento"))[0] || al.find((a) => a.lvl === "g");
  return pos ? [...crit, pos] : crit.concat(al.filter((a) => a.lvl !== "g").slice(4, 5));
}

// ─── buckets para los análisis por dimensión ────────────────────────────────
export type Bucket = { l: string; full?: string; a: Agg; sdr?: string; client?: string };
export const DOW_LABELS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

export function buckets(M: Model, f: Filters, dim: string, P: Period): Bucket[] {
  const fl = makeFilter(M, f);
  const end = endOf(P);
  if (dim === "sdr") return sdrList(M, f).map((s) => ({ l: s.short, full: s.name, sdr: s.key, a: agg(M, P, sdrFilter(M, f, s.key)) }));
  if (dim === "client") return clientRows(M, f, P).map((r) => ({ l: r.c.name, client: r.c.id, a: r.a }));
  if (dim === "country") return M.countries.filter((k) => !f.country || k === f.country).map((k) => ({ l: k, a: agg(M, P, makeFilter(M, { ...f, country: k })) }));
  if (dim === "leader") {
    const groups = [...M.leaders.map((l) => ({ id: l.key, name: `Equipo ${l.short}` })), { id: LEADERS_GROUP, name: "Líderes" }, { id: NO_CELL, name: "Sin célula" }];
    return groups.filter((g) => !f.leader || g.id === f.leader).map((g) => ({ l: g.name, a: agg(M, P, makeFilter(M, { ...f, leader: g.id, sdr: "" })) }));
  }
  if (dim === "dow") return [1, 2, 3, 4, 5].map((k) => {
    const ds = [...P.dates].filter((d) => parseDay(d).getUTCDay() === k);
    return { l: DOW_LABELS[k], a: agg(M, { dates: new Set(ds), bdays: ds.filter(isBusinessDay), fullGoal: false }, fl) };
  });
  if (dim === "day") return trendDays(M, P).map((d) => ({ l: d, a: agg(M, periodFromRange(d, d), fl) }));
  if (dim === "week") return lastWeeks(M, end, 8).map((w) => ({ l: `Sem ${w.short}`, a: agg(M, weekPeriod(M, w), fl) }));
  if (dim === "month") return M.months.filter((m) => monthStart(m) <= M.today).map((m) => {
    const e = monthEnd(m);
    return { l: m, a: agg(M, periodFromRange(monthStart(m), e < M.today ? e : M.today), fl) };
  });
  return [];
}

export { dayKey };
