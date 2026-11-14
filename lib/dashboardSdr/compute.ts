// Dashboard SDR — cálculo de todas las secciones a partir de la cartera de un
// SDR (SdrSlice). Sin dependencias de Node: lo usan la página, el servidor
// (resumen por SDR para la vista de la líder) y el correo semanal, así los
// tres muestran las mismas cifras.
import { CT_G } from "@/lib/radarAbm/dictionaries";
import { businessDaysBetween, businessDaysInMonth } from "@/lib/celulasSdr/calendar";
import { businessDaysSince, STALE_BUSINESS_DAYS, staleDays } from "./stale";
import type { SdrCompany, SdrContact, SdrMeeting, SdrSlice, SdrSummary } from "./types";

const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const shortDay = (d: string) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : "—");
function addDays(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// ── Grupos de status ────────────────────────────────────────────────────
export type CoGroup = "por_gestionar" | "en_gestion" | "reunion" | "cerradas";
export const CO_GROUP_LABEL: Record<CoGroup, string> = {
  por_gestionar: "Por gestionar", en_gestion: "En gestión / seguimiento", reunion: "Reunión / oportunidad", cerradas: "Descartadas / nutrir",
};
export function companyGroup(st: string): CoGroup {
  const t = norm(st);
  if (t.startsWith("en conversaciones") || t.includes("reuni") || t === "clientes" || t === "conv" || t.includes("oportunidad")) return "reunion";
  if (t === "asignada" || t === "por gestionar" || t === "sin status") return "por_gestionar";
  if (t.includes("en gesti") || t.includes("seguimiento") || t.includes("gestionada por linkedin") || t.includes("retomar")) return "en_gestion";
  return "cerradas";
}
const ctGroup = (st: string) => CT_G[st] ?? "";
export const isPendingContact = (k: SdrContact) => ctGroup(k.st) === "pend";
const isClosedContact = (k: SdrContact) => ["rej", "cal", "dispc", "pausa"].includes(ctGroup(k.st)) || norm(k.st).includes("reunion");

// Empresas devueltas a prospección (mismas definiciones que Células SDR → Devoluciones)
const RETURN_LABEL: Record<string, string> = {
  "no califica": "No califica",
  "gestionada - sin contactos fit": "Sin contactos fit",
  "gestionada - sin comunicacion": "Sin comunicación",
  "nutrir": "Nutrir",
  "sin contactos - (ya nutrida)": "Sin contactos (ya nutrida)",
};

// ── Meta del mes ────────────────────────────────────────────────────────
// Cumplimiento = realizadas ÷ meta (Asignación, SDR × cliente × mes).
// Esperado a la fecha = meta × días hábiles transcurridos ÷ días hábiles del
// mes (lun–vie sin feriados de Chile). Ritmo: al día (≥ 100% de lo esperado),
// en riesgo (70–99%) o atrasado (< 70%).
export type Pace = "ok" | "risk" | "late" | "none";
export function monthProgress(today: string) {
  const month = today.slice(0, 7);
  const total = businessDaysInMonth(month);
  const elapsed = businessDaysBetween(`${month}-01`, today).length;
  return { elapsed, total, share: total ? elapsed / total : 0 };
}
export function goalStatus(goal: number | null, done: number, share: number) {
  if (!goal) return { pct: null as number | null, expected: null as number | null, pace: "none" as Pace };
  const expected = Math.round(goal * share * 10) / 10;
  const ratio = expected > 0 ? done / expected : done > 0 ? 1 : 1;
  return { pct: Math.round((100 * done) / goal), expected, pace: (ratio >= 1 ? "ok" : ratio >= 0.7 ? "risk" : "late") as Pace };
}

// ── Por corregir ────────────────────────────────────────────────────────
export type FixKind = "est" | "seg" | "sta" | "reu" | "hs";
export const FIX_KINDS: { id: FixKind; label: string; help: string }[] = [
  { id: "est", label: "Cuentas estancadas", help: `Empresas en Asignada hace ${STALE_BUSINESS_DAYS} días hábiles o más desde su fecha de asignación.` },
  { id: "seg", label: "Seguimientos vencidos", help: "Empresas o contactos con fecha de próximo seguimiento ya pasada." },
  { id: "sta", label: "Status desactualizado", help: "El status de la empresa no calza con el de sus contactos." },
  { id: "reu", label: "Reuniones por actualizar", help: "Reuniones en Pendiente con fecha ya pasada en la planilla de reuniones." },
  { id: "hs", label: "Reunión sin status en HubSpot", help: "Reunión agendada en los últimos 30 días, pero la empresa no está en Reunión agendada en HubSpot." },
];
export type FixItem = { kind: FixKind; coId: string; who: string; sub: string; client: string; what: string; since: string; todo: string; sort: number };

export type Analysis = ReturnType<typeof analyze>;

// client: "" = todos los clientes
export function analyze(slice: SdrSlice, today: string, client = "") {
  const companies = slice.companies.filter((c) => !client || c.c === client);
  const contacts = slice.contacts.filter((k) => !client || k.c === client);
  const meetings = slice.meetings.filter((m) => !client || m.c === client);
  const month = today.slice(0, 7);
  const coById = new Map(companies.map((c) => [c.id, c]));
  const group = new Map(companies.map((c) => [c.id, companyGroup(c.st)]));

  // Por corregir
  const fixes: FixItem[] = [];
  for (const c of companies) {
    const g = group.get(c.id)!;
    const d = staleDays(c, today);
    if (d !== null && d >= STALE_BUSINESS_DAYS) {
      fixes.push({ kind: "est", coId: c.id, who: c.n, sub: `${c.nct} contacto${c.nct === 1 ? "" : "s"}`, client: c.c, what: c.nct ? "En Asignada sin gestión" : "En Asignada y sin contactos", since: `${d} días hábiles`, todo: c.nct ? "Gestionar o pasar a No califica" : "Pedir contactos a prospección", sort: -d });
    }
    if (c.next && c.next < today && (g === "en_gestion" || g === "por_gestionar")) {
      fixes.push({ kind: "seg", coId: c.id, who: c.n, sub: c.st, client: c.c, what: "Próximo seguimiento de la empresa", since: `Vencido el ${shortDay(c.next)}`, todo: "Retomar o cambiar el status", sort: Number(c.next.replace(/-/g, "")) });
    }
    if (g === "por_gestionar" && c.nmg > 0) {
      fixes.push({ kind: "sta", coId: c.id, who: c.n, sub: `${c.nmg} de ${c.nct} contactos gestionados`, client: c.c, what: "Empresa en Asignada con contactos ya gestionados", since: "—", todo: "Pasar la empresa a En gestión", sort: -c.nmg });
    } else if (g === "en_gestion" && c.nct > 0 && c.nmg === 0) {
      fixes.push({ kind: "sta", coId: c.id, who: c.n, sub: `0 de ${c.nct} contactos gestionados`, client: c.c, what: "Empresa en gestión sin ningún contacto gestionado", since: "—", todo: "Revisar el status de la empresa o de sus contactos", sort: 0 });
    }
  }
  for (const k of contacts) {
    if (!k.next || k.next >= today || isClosedContact(k)) continue;
    fixes.push({ kind: "seg", coId: k.co, who: k.n, sub: [k.cargo, k.con].filter(Boolean).join(" · "), client: k.c, what: `Próxima actividad del contacto (${k.st})`, since: `Vencido el ${shortDay(k.next)}`, todo: "Llamar y reagendar el seguimiento", sort: Number(k.next.replace(/-/g, "")) });
  }
  const since30 = addDays(today, -30);
  for (const m of meetings) {
    if (m.st === "Pendiente" && m.f && m.f < today) {
      const d = businessDaysSince(m.f, today);
      fixes.push({ kind: "reu", coId: m.co, who: m.con || "(sin empresa)", sub: m.ctn, client: m.c, what: `Reunión del ${shortDay(m.f)} sigue en Pendiente`, since: `${d} día${d === 1 ? "" : "s"} hábil${d === 1 ? "" : "es"}`, todo: "Marcar Realizada, No-show o Reagendar en la planilla", sort: -d });
    }
    if ((m.st === "Pendiente" || m.st === "Realizada") && m.co && m.ag >= since30 && coById.has(m.co) && group.get(m.co) !== "reunion") {
      fixes.push({ kind: "hs", coId: m.co, who: m.con, sub: m.ctn, client: m.c, what: `Reunión agendada el ${shortDay(m.ag)}; en HubSpot la empresa sigue en «${coById.get(m.co)!.st}»`, since: shortDay(m.ag), todo: "Pasar la empresa a Reunión agendada en HubSpot", sort: -Number(m.ag.replace(/-/g, "")) });
    }
  }
  fixes.sort((a, b) => a.sort - b.sort);
  const fixBy = Object.fromEntries(FIX_KINDS.map((k) => [k.id, fixes.filter((f) => f.kind === k.id)])) as Record<FixKind, FixItem[]>;
  // Etiqueta "por corregir" por empresa (detalle)
  const flagOf = new Map<string, string>();
  for (const f of fixes) if (f.coId && !flagOf.has(f.coId)) flagOf.set(f.coId, FIX_KINDS.find((k) => k.id === f.kind)!.label + (f.kind === "est" ? ` (${f.since.split(" ")[0]} d)` : ""));

  // Reuniones del mes (agendadas por fecha de agendamiento; el resto por fecha de reunión)
  const mtgStats = (ms: SdrMeeting[]) => ({
    ag: ms.filter((m) => m.ag.startsWith(month)).length,
    re: ms.filter((m) => m.f.startsWith(month) && m.st === "Realizada").length,
    ns: ms.filter((m) => m.f.startsWith(month) && m.st === "No-show").length,
    pe: ms.filter((m) => m.f.startsWith(month) && m.st === "Pendiente").length,
    pePast: ms.filter((m) => m.f.startsWith(month) && m.st === "Pendiente" && m.f < today).length,
    fc: ms.filter((m) => m.f.startsWith(month) && m.fc).length, // "Para facturar" (por fecha de reunión)
  });
  const withMtg = (cs: SdrCompany[]) => cs.filter((c) => group.get(c.id) === "reunion" || c.msch > 0).length;

  // Por cliente
  const prog = monthProgress(today);
  // Clientes del SDR: con empresas, contactos o reuniones en Pulso, o con meta en Asignación
  const clients = [...new Set([...companies.map((c) => c.c), ...contacts.map((k) => k.c), ...meetings.map((m) => m.c),
    ...Object.keys(slice.goals).filter((c) => !client || c === client)])].sort();
  const perClient = clients.map((cl) => {
    const cs = companies.filter((c) => c.c === cl);
    const ks = contacts.filter((k) => k.c === cl);
    const g = { por_gestionar: 0, en_gestion: 0, reunion: 0, cerradas: 0 } as Record<CoGroup, number>;
    for (const c of cs) g[group.get(c.id)!]++;
    const hasData = !!slice.ctData[cl];
    const pct = (f: (k: SdrContact) => boolean) => (hasData && ks.length ? Math.round((100 * ks.filter(f).length) / ks.length) : null);
    const ms = mtgStats(meetings.filter((m) => m.c === cl));
    const fx = fixes.filter((f) => f.client === cl);
    return {
      client: cl, cos: cs.length, groups: g,
      stock: ks.filter(isPendingContact).length, cts: ks.length,
      none: cs.filter((c) => c.nct === 0).length, one: cs.filter((c) => c.nct === 1).length,
      tel: pct((k) => k.ph === 1), mail: pct((k) => k.ml === 1), li: pct((k) => k.lk === 1),
      telN: hasData ? ks.filter((k) => k.ph === 1).length : 0, telD: hasData ? ks.length : 0,
      goal: slice.goals[cl] ?? null, ...ms, ...goalStatus(slice.goals[cl] ?? null, ms.re, prog.share), withMtg: withMtg(cs),
      fixN: fx.length, fixEst: fx.filter((f) => f.kind === "est").length, fixSeg: fx.filter((f) => f.kind === "seg").length,
    };
  });

  // Calidad de la gestión
  const worked = companies.filter((c) => c.nmg > 0);
  const depth = [
    { label: "1 contacto", n: worked.filter((c) => c.nmg === 1).length },
    { label: "2 a 3 contactos", n: worked.filter((c) => c.nmg >= 2 && c.nmg <= 3).length },
    { label: "4 o más contactos", n: worked.filter((c) => c.nmg >= 4).length },
  ];
  const ret = new Map<string, { n: number; none: number }>();
  for (const c of companies) {
    const label = RETURN_LABEL[norm(c.st)];
    if (!label) continue;
    const r = ret.get(label) ?? { n: 0, none: 0 };
    r.n++;
    if (!c.tr) r.none++;
    ret.set(label, r);
  }
  const returns = [...ret.entries()].map(([label, r]) => ({ label, ...r })).sort((a, b) => b.n - a.n);
  const stCount = new Map<string, number>();
  for (const k of contacts) stCount.set(k.st, (stCount.get(k.st) ?? 0) + 1);
  const stSorted = [...stCount.entries()].sort((a, b) => b[1] - a[1]);
  const ctStatus = stSorted.slice(0, 6).map(([label, n]) => ({ label, n }));
  if (stSorted.length > 6) ctStatus.push({ label: "Otros", n: stSorted.slice(6).reduce((s, [, n]) => s + n, 0) });

  // Perfiles de las reuniones (últimos 90 días, por fecha de agendamiento)
  const since90 = addDays(today, -90);
  const recent = meetings.filter((m) => m.ag >= since90);
  const profile = (key: "sen" | "area") => {
    const m = new Map<string, number>();
    for (const x of recent) { const v = x[key] || "Sin dato"; m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  };

  const unw = companies.filter((c) => group.get(c.id) === "por_gestionar").length;
  // Meta total = suma de las metas de los clientes visibles; realizadas solo de esos clientes
  const goalClients = perClient.filter((p) => p.goal);
  const goalTotal = goalClients.reduce((s, p) => s + (p.goal ?? 0), 0);
  const goalDone = goalClients.reduce((s, p) => s + p.re, 0);
  return {
    companies, contacts, meetings, group, fixes, fixBy, flagOf, perClient, clients,
    totals: {
      cos: companies.length, unw, cts: contacts.length, none: companies.filter((c) => c.nct === 0).length,
      withMtg: withMtg(companies), fix: fixes.length,
    },
    mtg: mtgStats(meetings),
    goal: { total: goalTotal || null, done: goalDone, ...goalStatus(goalTotal || null, goalDone, prog.share), elapsed: prog.elapsed, days: prog.total },
    quality: { depth, returns, ctStatus, worked: worked.length },
    profile: { sen: profile("sen"), area: profile("area"), n: recent.length },
  };
}

// Resumen por SDR para la vista de la líder
export function summarize(slice: SdrSlice, today: string): SdrSummary {
  const a = analyze(slice, today);
  return {
    cos: a.totals.cos, unw: a.totals.unw,
    est: a.fixBy.est.length, seg: a.fixBy.seg.length, sta: a.fixBy.sta.length, reu: a.fixBy.reu.length, hs: a.fixBy.hs.length,
    ag: a.mtg.ag, re: a.mtg.re, ns: a.mtg.ns, pe: a.mtg.pe, withMtg: a.totals.withMtg,
    goal: a.goal.total ?? 0, goalDone: a.goal.done,
    oldest: a.fixBy.est.slice(0, 8).map((f) => ({ n: f.who, c: f.client, d: Number(f.since.split(" ")[0]) })),
    perClient: a.perClient.map((p) => ({ c: p.client, cos: p.cos, none: p.none, stock: p.stock, telN: p.telN, telD: p.telD })),
  };
}
