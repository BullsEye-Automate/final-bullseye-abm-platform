import type { RadarConfig, RadarDataset } from "./types";
import { PEND, PAUSA, EFF, POS, REJ, MIN_N, HEALTH_COMPONENTS, coKey, DEFAULT_CONFIG } from "./dictionaries";

// Pulso ABM — cálculo de métricas. Port 1:1 de las funciones del prototipo
// Radar_ABM_BullsEye_BETA.html (compute, health, seg, segCo, barrier,
// objectionPattern, insights, learnings, recsBE, recsCli): con el set de
// datos demo debe dar exactamente las mismas cifras. Las únicas diferencias
// son que la fecha de corte, los meses y las metas/pesos del Health Score
// vienen del set de datos y de la configuración en vez de estar fijos.
//
// Los objetos se enriquecen en memoria (c.K, k.eff, m.q…), igual que en el
// prototipo; por eso compute() trabaja sobre una copia del set de datos.

export type Model = any;

/* ---------- utilidades ---------- */
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
export const by = <T,>(a: T[], f: (x: T) => any): Record<string, T[]> =>
  a.reduce((m: Record<string, T[]>, x) => {
    const k = f(x);
    (m[k] ||= []).push(x);
    return m;
  }, {});
export const cnt = <T,>(a: T[], f: (x: T) => any) => a.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
export const sum = <T,>(a: T[], f: (x: T) => any) => a.reduce((n, x) => n + (f(x) || 0), 0);
export const div = (a: number, b: number) => (b ? a / b : null);
export const P = (v: number | null | undefined, d = 0) =>
  v == null || isNaN(v) ? "—" : (v * 100).toFixed(d).replace(".", ",") + "%";
export const N = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("es-CL"));
export const F1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1).replace(".", ","));
export const USD = (v: number) => "US$ " + Math.round(v / 1000).toLocaleString("es-CL") + "k";
export const dmy = (s?: string | null) => (s ? s.slice(8, 10) + "-" + s.slice(5, 7) + "-" + s.slice(0, 4) : "—");
const DAY = 864e5;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Meses del período (YYYY-MM) entre el inicio y la fecha de corte
export function periodMonths(period: [string, string], today: string): string[] {
  const out: string[] = [];
  let y = Number(period[0].slice(0, 4)), m = Number(period[0].slice(5, 7));
  const endKey = today.slice(0, 7);
  for (let i = 0; i < 60; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
const daysInMonth = (mo: string) => new Date(Date.UTC(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)), 0)).getUTCDate();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Tramos de las series de evolución. Sin rango de fechas: meses del período
// (como el prototipo). Con rango: días (hasta 2 semanas), semanas de lunes a
// domingo (hasta ~3 meses) o meses.
export type RadarGran = "month" | "week" | "day";
export type Bucket = { k: string; from: string; to: string; lab: string; days: number };
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
export function mondayOf(d: string) {
  const dow = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}
function buildBuckets(ds: RadarDataset, today: string): { gran: RadarGran; B: Bucket[] } {
  const monthB = (mo: string): Bucket => ({ k: mo, from: mo + "-01", to: `${mo}-${String(daysInMonth(mo)).padStart(2, "0")}`, lab: MONTH_ABBR[Number(mo.slice(5, 7)) - 1], days: daysInMonth(mo) });
  if (!ds.range) return { gran: "month", B: periodMonths(ds.period, today).map(monthB) };
  const { from } = ds.range;
  const to = ds.range.to > today && from <= today ? today : ds.range.to;
  const span = daysBetween(from, to) + 1;
  const B: Bucket[] = [];
  if (span <= 14) {
    for (let d = from; d <= to && B.length < 400; d = addDays(d, 1)) B.push({ k: d, from: d, to: d, lab: ddmm(d), days: 1 });
    return { gran: "day", B };
  }
  if (span <= 92) {
    for (let d = mondayOf(from); d <= to && B.length < 60; d = addDays(d, 7)) B.push({ k: d, from: d, to: addDays(d, 6), lab: "", days: 7 });
    return { gran: "week", B: B.map(clip).map((x) => ({ ...x, lab: ddmm(x.from) })) };
  }
  return { gran: "month", B: periodMonths([from, to], to).map(monthB).map(clip) };
  // Los tramos de los bordes se recortan al rango (la semana del 27/07 parte el 01/08)
  function clip(x: Bucket): Bucket {
    const f = x.from < from ? from : x.from, t = x.to > ds.range!.to ? ds.range!.to : x.to;
    return { ...x, from: f, to: t, days: daysBetween(f, t) + 1 };
  }
}
export const inBucket = (d: string | null | undefined, b: Bucket) => !!d && d.slice(0, 10) >= b.from && d.slice(0, 10) <= b.to;

/* ---------- cálculo ---------- */
export function compute(ds: RadarDataset, cfg: RadarConfig = DEFAULT_CONFIG): Model {
  const cl: any = structuredClone(ds.client);
  const TODAY = ds.generated;
  const { gran, B } = buildBuckets(ds, TODAY);
  const MONTHS = B.map((b) => b.k);
  const partial = B.length > 0 && B[B.length - 1].to > TODAY;
  const MLAB: Record<string, string> = Object.fromEntries(B.map((b, i) => [b.k, b.lab + (i === B.length - 1 && partial ? "*" : "")]));

  const C: any[] = cl.companies, K: any[] = cl.contacts, Mt: any[] = cl.meetings, Dl: any[] = cl.deals;
  const co = new Map(C.map((c) => [c.id, c]));
  K.forEach((k) => { k.c = co.get(k.co); k.eff = EFF.has(k.st); k.mg = !PEND.has(k.st) && k.st !== PAUSA; });
  const ctBy = by(K, (k) => k.co);
  const mByCo = by(Mt, (m) => m.co);
  C.forEach((c) => {
    c.K = ctBy[c.id] || []; c.M = mByCo[c.id] || []; c.key = coKey(c.st); c.worked = c.st !== "Asignada";
    c.effK = c.K.filter((k: any) => k.eff); c.conv = c.effK.some((k: any) => k.st !== "Contacto No Fit para gestión"); c.pos = c.K.some((k: any) => POS.has(k.st));
  });
  const kById = new Map(K.map((k) => [k.id, k]));
  Mt.forEach((m) => { m.k = kById.get(m.ct); m.c = co.get(m.co); });
  const M: Model = { cl, C, K, Mt, Dl, TODAY, MONTHS, MLAB, B, gran, range: ds.range ?? null, partial, cfg, source: ds.source, syncedAt: ds.syncedAt ?? null };
  const worked = C.filter((c) => c.worked), qual = C.filter((c) => c.st !== "No califica");
  const mg = K.filter((k) => k.mg), eff = K.filter((k) => k.eff);
  const icpK = K.filter((k) => k.c.st !== "No califica");
  const coEff = C.filter((c) => c.effK.length >= 1), coMulti = C.filter((c) => c.effK.length >= 2), coDeep = C.filter((c) => c.depth === "Profunda");
  const coMt = C.filter((c) => c.M.length), coHeld = C.filter((c) => c.mheld);
  // Con rango de fechas (como el Excel de metas): agendadas por fecha de
  // agendamiento; realizadas / no-show / canceladas por fecha de la reunión
  const rg = ds.range, inRg = (d?: string | null) => !rg || (!!d && d >= rg.from && d <= rg.to);
  const agM = rg ? Mt.filter((m) => inRg(m.agendada)) : Mt;
  const held = Mt.filter((m) => m.st === "Realizada" && inRg(m.fecha)), noshow = Mt.filter((m) => m.st === "No-show" && inRg(m.fecha)), canc = Mt.filter((m) => m.st === "Cancelada" && inRg(m.fecha));
  const pendM = Mt.filter((m) => m.st === "Pendiente" || m.st === "Reprogramada"), reprog = Mt.filter((m) => m.reprog || m.st === "Reprogramada");
  Object.assign(M, { worked, qual, mg, eff, icpK, coEff, coMulti, coDeep, coMt, coHeld, held, noshow, canc, pendM, reprog, agM });
  M.kpi = {
    universe: C.length, worked: worked.length, coverage: div(worked.length, C.length),
    penetration: div(cnt(icpK, (k) => k.mg), icpK.length),
    contactRate: div(eff.length, mg.length),
    phoneGap: div(cnt(mg, (k) => k.st === "Sin Información de Contacto"), mg.length),
    multi: div(coMulti.length, coEff.length), deep: div(coDeep.length, coEff.length),
    mPerAcc: div(Mt.length, coMt.length), mPerCt: div(Mt.length, eff.length),
    realization: div(held.length, held.length + noshow.length + canc.length),
    convToMeet: div(coMt.length, C.filter((c) => c.conv).length),
    ctToMeet: div(cnt(K, (k) => k.st === "Reunión Agendada"), eff.length),
    opp: C.filter((c) => c.opp).length, oppRate: div(cnt(coHeld, (c) => c.opp), coHeld.length),
    referralRate: div(cnt(K, (k) => k.st === "Refiere con el Tomador de Decisiones"), eff.length),
    interlocutors: div(sum(coMt, (c) => new Set(c.M.map((m: any) => m.ct)).size), coMt.length),
  };
  // seguimientos
  const fuK = K.filter((k) => k.st === "Hacer Seguimiento");
  const fuC = C.filter((c) => c.st === "En seguimiento" || c.st === "Sin interés ahora - Retomar");
  const in14 = addDays(TODAY, 14);
  M.fu = {
    K: fuK, C: fuC, overdue: fuK.filter((k) => k.next && k.next < TODAY), soon: fuK.filter((k) => k.next && k.next >= TODAY && k.next <= in14),
    none: fuK.filter((k) => !k.next), later: fuK.filter((k) => k.next && k.next > in14), coNone: fuC.filter((c) => !c.next), coOver: fuC.filter((c) => c.next && c.next < TODAY),
  };
  // referrals
  const refs = K.filter((k) => k.st === "Refiere con el Tomador de Decisiones"), refd = K.filter((k) => k.refBy);
  M.ref = {
    refs, refd, noChild: refs.filter((r) => !refd.some((x) => x.refBy === r.id)),
    conv: refd.filter((k) => k.eff), fu: refd.filter((k) => k.st === "Hacer Seguimiento"), meet: refd.filter((k) => k.st === "Reunión Agendada"), pend: refd.filter((k) => PEND.has(k.st)),
  };
  // calidad de reuniones (§7)
  held.forEach((m) => {
    const known = [true, true, m.need != null, m.res != null, m.fb != null].filter(Boolean).length;
    const pts = (m.icpfit ? 1 : 0) + (m.okct ? 1 : 0) + (m.need ? 1 : 0) + (m.next === true ? 1 : 0) + (m.res === "Oportunidad" || m.res === "Seguimiento" ? 1 : 0);
    m.q = known < 4 ? "na" : pts >= 4 ? "hi" : pts >= 2 ? "md" : "lo";
  });
  // pipeline
  M.pipe = cl.pipeline
    ? {
        open: sum(Dl.filter((d) => !["Ganado", "Perdido"].includes(d.stage)), (d) => d.amount),
        won: sum(Dl.filter((d) => d.stage === "Ganado"), (d) => d.amount), n: Dl.length, byStage: by(Dl, (d) => d.stage),
      }
    : null;
  // mensual
  M.month = B.map((b) => ({
    mo: b.k, days: b.days, to: b.to, asg: cnt(C, (c) => inBucket(c.asg, b)), eff: cnt(eff, (k) => inBucket(k.last, b)),
    sch: cnt(Mt, (m) => inBucket(m.agendada, b)), held: cnt(held, (m) => inBucket(m.fecha, b)),
  }));
  // Tendencia: siempre por meses completos del período del informe, aunque
  // se elija un mes, semana o día en el selector de fechas
  if (ds.trendBase) {
    const tm = periodMonths(ds.trendBase.period, TODAY);
    M.trendM = tm.map((mo) => ({ mo, lab: MONTH_ABBR[Number(mo.slice(5, 7)) - 1], days: daysInMonth(mo), to: `${mo}-${String(daysInMonth(mo)).padStart(2, "0")}`, sch: cnt(ds.trendBase!.agendadas, (d) => d.startsWith(mo)) }));
  } else {
    M.trendM = M.month.map((m: any) => ({ ...m, lab: MLAB[m.mo].replace("*", "") }));
  }
  M.health = health(M, cfg);
  M.ad = activityDepth(M);
  return M;
}

// Tendencia: reuniones agendadas de la segunda mitad del período vs la
// primera (con 6 meses: últimos 3 vs 3 previos). El mes en curso se
// normaliza por los días transcurridos.
function trendRatio(M: Model): number | null {
  const months: any[] = M.trendM;
  if (months.length < 2) return null;
  const half = Math.floor(months.length / 2);
  const firstM = months.slice(months.length - 2 * half, months.length - half), lastM = months.slice(months.length - half);
  const first = sum(firstM, (m) => m.sch);
  const lastDays = sum(lastM, (m) => m.days);
  const elapsed = lastDays - Math.max(0, daysBetween(M.TODAY, lastM[lastM.length - 1].to));
  const last = sum(lastM, (m) => m.sch) * (lastDays / Math.max(1, elapsed));
  return first ? last / first : null;
}

export function health(M: Model, cfg: RadarConfig = DEFAULT_CONFIG) {
  const k = M.kpi, f = M.fu;
  const fuTot = f.K.length, qEval = M.held.filter((m: any) => m.q !== "na");
  const icpBad = cnt(M.worked, (c: any) => ["No califica", "Gestionada - sin contactos fit", "Sin contactos - (ya nutrida)"].includes(c.st));
  const ratio = trendRatio(M);
  const values: Record<string, number | null> = {
    coverage: k.coverage,
    contactRate: k.contactRate,
    convToMeet: k.convToMeet,
    realization: k.realization,
    quality: qEval.length >= 5 ? div(cnt(qEval, (m: any) => m.q === "hi") + 0.5 * cnt(qEval, (m: any) => m.q === "md"), qEval.length) : null,
    followup: fuTot ? 1 - (f.overdue.length + f.none.length) / fuTot : null,
    multi: k.multi,
    opp: M.coHeld.length >= 3 ? k.oppRate : null,
    icpFit: M.worked.length ? 1 - icpBad / M.worked.length : null,
    trend: ratio == null ? null : Math.max(0, Math.min(1, 0.6 + (ratio - 1) * 0.4)),
  };
  const comp = HEALTH_COMPONENTS.map(({ key, name, formula }) => {
    const { weight: w, target: t } = cfg.health[key] ?? DEFAULT_CONFIG.health[key];
    const v = values[key];
    return { key, n: name, w, v, t, f: formula, s: v == null || !w ? null : Math.min(1, v / t) * 100 };
  });
  const used = comp.filter((c) => c.s != null), wt = sum(used, (c) => c.w);
  const score = wt ? Math.round(sum(used, (c) => (c.s as number) * c.w) / wt) : 0;
  return {
    comp, score, wt, ratio,
    band: (score >= 75 ? ["Saludable", "hi"] : score >= 55 ? ["Requiere atención", "md"] : ["En riesgo", "lo"]) as [string, string],
  };
}

/* ---------- segmentación ---------- */
export function seg(M: Model, keyFn: (k: any) => any, list?: any[]) {
  const rows = by(list || M.K, keyFn);
  return Object.entries(rows).map(([key, K]) => {
    const mg = K.filter((k: any) => k.mg), eff = K.filter((k: any) => k.eff), meet = K.filter((k: any) => k.st === "Reunión Agendada");
    return {
      key, n: K.length, mg: mg.length, eff: eff.length, meet: meet.length,
      held: cnt(meet, (k: any) => M.Mt.some((m: any) => m.ct === k.id && m.st === "Realizada")),
      fu: cnt(K, (k: any) => k.st === "Hacer Seguimiento"), rej: cnt(K, (k: any) => REJ.has(k.st)), ref: cnt(K, (k: any) => k.st === "Refiere con el Tomador de Decisiones"),
      nr: cnt(K, (k: any) => k.st === "No Contestó" || k.st === "Sin Información de Contacto"), pos: cnt(K, (k: any) => POS.has(k.st)),
      acts: sum(K, (k: any) => (k.calls || 0) + (k.wa || 0) + (k.li || 0) + (k.em || 0)),
      cr: div(eff.length, mg.length), c2m: div(meet.length, eff.length), k2m: div(meet.length, mg.length), small: eff.length < MIN_N,
    } as any;
  }).sort((a, b) => b.n - a.n);
}
export function segCo(M: Model, keyFn: (c: any) => any) {
  return Object.entries(by(M.C as any[], keyFn)).map(([key, C]) => {
    const K = C.flatMap((c: any) => c.K), w = C.filter((c: any) => c.worked);
    const s = seg(M, () => "x", K)[0] || { eff: 0, mg: 0, meet: 0, held: 0, fu: 0, acts: 0, cr: null };
    return {
      key, co: C.length, worked: w.length, cov: div(w.length, C.length), ct: K.length, acts: s.acts, eff: s.eff, cr: s.cr,
      coMt: cnt(C, (c: any) => c.M.length), mt: sum(C, (c: any) => c.M.length), held: sum(C, (c: any) => c.mheld),
      real: div(sum(C, (c: any) => c.mheld), sum(C, (c: any) => cnt(c.M, (m: any) => ["Realizada", "No-show", "Cancelada"].includes(m.st)))),
      fu: cnt(C, (c: any) => c.fu), opp: cnt(C, (c: any) => c.opp), mRate: div(cnt(C, (c: any) => c.M.length), w.length), pend: cnt(C, (c: any) => c.st === "Asignada"),
      conv: cnt(C, (c: any) => c.conv), small: w.length < 8,
    } as any;
  }).sort((a, b) => b.co - a.co);
}

/* ---------- insights por reglas (cada uno con su evidencia) ---------- */
export function barrier(M: Model) {
  const w = M.worked;
  const g: Record<string, number> = {
    "rechazo explícito": cnt(w, (c: any) => c.st === "No interesados"),
    "timing / interés futuro": cnt(w, (c: any) => c.st === "Sin interés ahora - Retomar"),
    "contactabilidad (no se logra hablar)": cnt(w, (c: any) => ["Gestionada - sin comunicación", "Nutrir", "Gestionada por LinkedIn"].includes(c.st)),
    "disponibilidad de contactos ICP": cnt(w, (c: any) => ["Gestionada - sin contactos fit", "Sin contactos - (ya nutrida)"].includes(c.st)),
    "empresas fuera de ICP": cnt(w, (c: any) => c.st === "No califica"),
  };
  const arr = Object.entries(g).sort((a, b) => b[1] - a[1]);
  return { arr, main: arr[0], tot: sum(arr, (a) => a[1]) };
}
export function objectionPattern(M: Model) {
  const ob = M.K.filter((k: any) => k.obj && k.obj !== "No es responsable");
  if (ob.length < MIN_N) return null;
  const topObj = Object.entries(by(ob, (k: any) => k.obj)).sort((a, b) => b[1].length - a[1].length)[0];
  const base = topObj[1].length / ob.length;
  let best: { lab: string; key: string; sh: number; n: number } | null = null;
  const tryDim = (lab: string, f: (k: any) => any) =>
    Object.entries(by(ob, f)).forEach(([key, arr]) => {
      if (arr.length < 6 || key === "null" || key === "undefined") return;
      const sh = cnt(arr, (k: any) => k.obj === topObj[0]) / arr.length;
      if (sh > base * 1.25 && (!best || sh > best.sh)) best = { lab, key, sh, n: arr.length };
    });
  tryDim("industria", (k) => k.c.ind); tryDim("tamaño", (k) => k.c.size); tryDim("área", (k) => k.area);
  return { obj: topObj[0], n: topObj[1].length, share: base, best: best as { lab: string; key: string; sh: number; n: number } | null, tot: ob.length };
}

export function insights(M: Model) {
  const out: { t: string; ev: string; i: string }[] = []; const k = M.kpi;
  const areas = seg(M, (x) => x.area).filter((a) => a.mg >= 20);
  const aCR = areas.slice().sort((a, b) => b.cr - a.cr)[0], aC2M = areas.filter((a) => a.eff >= MIN_N).sort((a, b) => b.c2m - a.c2m)[0];
  if (aCR && aC2M) out.push(aCR.key !== aC2M.key
    ? { t: `${aCR.key} es el área que más responde, pero ${aC2M.key} es la que más convierte a reunión.`, ev: `Contacto efectivo: ${aCR.key} ${P(aCR.cr)} (n=${aCR.mg} gestionados). Conversación→reunión: ${aC2M.key} ${P(aC2M.c2m)} (n=${aC2M.eff} efectivos).`, i: "Conviene abrir la cuenta por el área que contesta y usarla para llegar al área que decide." }
    : { t: `${aCR.key} lidera tanto en respuesta como en conversión a reunión.`, ev: `Contacto efectivo ${P(aCR.cr)} (n=${aCR.mg}); conversación→reunión ${P(aCR.c2m)} (n=${aCR.eff}).`, i: "Es el rol de entrada más eficiente para este cliente." });
  const b = barrier(M);
  if (b.tot >= MIN_N) {
    const rej = b.arr.find((a) => a[0] === "rechazo explícito")![1];
    out.push({
      t: b.main[0] === "rechazo explícito" ? "La principal barrera es el rechazo explícito de los decisores." : `La principal barrera no es la falta de interés sino ${b.main[0]}.`,
      ev: b.arr.map((a) => `${a[0]}: ${a[1]}`).join(" · ") + ` (empresas trabajadas con destino negativo o neutro, n=${b.tot}).`,
      i: b.main[0] === "rechazo explícito" ? "Revisar mensaje y segmento antes de aumentar volumen." : `El rechazo explica solo ${P(rej / b.tot)} de los cierres; el resto se puede atacar con datos, canal o calendario.`,
    });
  }
  const sz = seg(M, (x) => x.c.size), ent = sz.find((s) => s.key === "Enterprise"), oth = seg(M, (x) => (x.c.size === "Enterprise" ? "E" : "O")).find((s) => s.key === "O");
  if (ent && oth && ent.eff >= MIN_N && oth.eff >= MIN_N) {
    const lowReach = ent.cr < oth.cr, hiConv = ent.c2m > oth.c2m;
    out.push({
      t: `Las empresas Enterprise ${lowReach ? "son más difíciles de contactar" : "se contactan igual o mejor"} ${lowReach === hiConv ? "pero" : "y"} ${hiConv ? "convierten mejor" : "convierten peor"} cuando se logra conversación.`,
      ev: `Contacto efectivo Enterprise ${P(ent.cr)} vs resto ${P(oth.cr)}. Conversación→reunión Enterprise ${P(ent.c2m)} vs resto ${P(oth.c2m)} (n=${ent.eff} y ${oth.eff}).`,
      i: hiConv ? "Justifica más intentos y más interlocutores por cuenta Enterprise antes de descartarla." : "El esfuerzo extra en Enterprise no se está traduciendo en reuniones.",
    });
  }
  const one = M.C.filter((c: any) => c.effK.length === 1), two = M.C.filter((c: any) => c.effK.length >= 2);
  if (one.length >= MIN_N && two.length >= 5) {
    const r1 = cnt(one, (c: any) => c.M.length) / one.length, r2 = cnt(two, (c: any) => c.M.length) / two.length;
    out.push({
      t: r2 > r1 ? `Las cuentas con dos o más interlocutores tienen ${F1(r2 / Math.max(r1, 0.001))} veces más probabilidad de terminar en reunión.` : "Tener más interlocutores por cuenta no se asocia a más reuniones en este cliente.",
      ev: `Empresas con reunión: ${P(r2)} con 2+ contactos efectivos (n=${two.length}) vs ${P(r1)} con 1 contacto efectivo (n=${one.length}).`,
      i: "Relación observada, no causal: parte del efecto viene de que las cuentas interesadas abren más puertas.",
    });
  }
  const op = objectionPattern(M);
  if (op) out.push({
    t: `La objeción más frecuente es "${op.obj}"${op.best ? ` y se concentra en ${op.best.lab} ${op.best.key}` : ""}.`,
    ev: `${op.n} de ${op.tot} objeciones registradas (${P(op.share)}).${op.best ? ` En ${op.best.lab} ${op.best.key} sube a ${P(op.best.sh)} (n=${op.best.n}).` : ""}`, i: "Define el argumento que el cliente debe preparar primero.",
  });
  const rf = M.ref;
  if (rf.refd.length >= 5) {
    const rcr = div(rf.conv.length, cnt(rf.refd, (x: any) => x.mg)), rm = div(rf.meet.length, rf.conv.length);
    out.push({
      t: `Los contactos que llegan por referral responden ${(rcr ?? 0) > k.contactRate ? "mejor" : "peor"} que la base general.`,
      ev: `Contacto efectivo en referidos ${P(rcr)} vs ${P(k.contactRate)} en la base (n=${rf.refd.length} referidos${rf.refd.length < MIN_N ? ", muestra chica" : ""}). Reunión sobre conversación en referidos: ${P(rm)}.`, i: "Cada referral es un atajo al decisor y no un contacto perdido.",
    });
  }
  const sn = seg(M, (x) => x.sen), cl = sn.find((s) => s.key === "C-Level"), jf = sn.find((s) => s.key === "Jefatura");
  if (cl && jf && cl.mg >= 15 && jf.mg >= 15) out.push({
    t: `C-Level contesta ${cl.cr < jf.cr ? "menos" : "más"} que jefaturas, ${cl.c2m > jf.c2m ? "pero cuando conversa convierte más" : "y convierte menos"}.`,
    ev: `Contacto efectivo C-Level ${P(cl.cr)} vs Jefatura ${P(jf.cr)}. Conversación→reunión ${P(cl.c2m)} vs ${P(jf.c2m)} (n=${cl.eff} y ${jf.eff}${cl.small || jf.small ? ", muestra chica" : ""}).`, i: cl.c2m > jf.c2m ? "Mantener C-Level como objetivo, con jefaturas como vía de referral." : "Las jefaturas son mejor punto de entrada.",
  });
  const obs = M.K.filter((x: any) => x.obj && x.obj !== "No es responsable");
  if (obs.length >= MIN_N) {
    const tm = cnt(obs, (x: any) => ["Timing", "Proyecto futuro", "No prioridad", "Sin presupuesto"].includes(x.obj)), fd = cnt(obs, (x: any) => ["Ya tiene proveedor", "No necesidad", "Solución interna"].includes(x.obj));
    out.push({
      t: tm > fd ? "La mayoría de las objeciones son de momento, no de fondo." : "Predominan las objeciones de fondo sobre las de momento.",
      ev: `Momento (timing, proyecto futuro, prioridad, presupuesto): ${tm} (${P(tm / obs.length)}). Fondo (proveedor, necesidad, solución interna): ${fd} (${P(fd / obs.length)}).`,
      i: tm > fd ? "Hay stock de cuentas que se puede recuperar con nurturing y fechas de retoma." : "Se necesita un argumento de reemplazo o complemento del proveedor actual.",
    });
  }
  return out;
}

export function learnings(M: Model) {
  const L: [string, string, string][] = [], k = M.kpi, obs = M.K.filter((x: any) => x.obj && x.obj !== "No es responsable");
  if (obs.length >= MIN_N) {
    const t = Object.entries(by(obs, (x: any) => x.obj)).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    L.push(["Qué dice el mercado", `Las respuestas negativas se explican por ${t.map(([o, a]) => `${o.toLowerCase()} (${P(a.length / obs.length)})`).join(", ")}.`, `n=${obs.length} objeciones con motivo registrado.`]);
  }
  const needs = M.held.filter((m: any) => m.need);
  if (needs.length >= 3) {
    const t = Object.entries(by(needs, (m: any) => m.need)).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    L.push(["Qué necesita", `En las reuniones realizadas aparecen como necesidades principales: ${t.map(([n, a]) => `${n.toLowerCase()} (${a.length})`).join(", ")}.`, `${needs.length} de ${M.held.length} reuniones realizadas tienen necesidad registrada${needs.length < MIN_N ? "; muestra chica" : ""}.`]);
  }
  const op = objectionPattern(M);
  if (op && op.best) L.push(["Qué objeciones aparecen", `"${op.obj}" no es transversal: pesa más en ${op.best.lab} ${op.best.key} (${P(op.best.sh)} vs ${P(op.share)} promedio).`, `n=${op.best.n} objeciones en ese segmento.`]);
  const ind = segCo(M, (c) => c.ind || "Sin industria").filter((s) => !s.small && s.key !== "Sin industria").sort((a, b) => b.mRate - a.mRate);
  if (ind.length >= 2) L.push(["Qué segmentos responden", `${ind[0].key} es el segmento con mejor tasa de reunión por empresa trabajada (${P(ind[0].mRate)}); ${ind[ind.length - 1].key} es el más bajo (${P(ind[ind.length - 1].mRate)}).`, `Empresas trabajadas: ${ind[0].worked} y ${ind[ind.length - 1].worked}.`]);
  const ar = seg(M, (x) => x.area).filter((a) => a.eff >= MIN_N).map((a) => ({ ...a, pr: a.pos / a.eff })).sort((a, b) => b.pr - a.pr);
  if (ar.length >= 2) L.push(["Qué cargos muestran más interés", `${ar[0].key} tiene la mayor proporción de resultados positivos (reunión, seguimiento o referral) cuando hay conversación: ${P(ar[0].pr)}. ${ar[ar.length - 1].key} es el más bajo: ${P(ar[ar.length - 1].pr)}.`, `n=${ar[0].eff} y ${ar[ar.length - 1].eff} contactos efectivos.`]);
  const ms = M.K.filter((x: any) => x.st === "Reunión Agendada" && x.sig);
  if (ms.length >= 5) {
    const pain = cnt(ms, (x: any) => x.sig === "Expresa necesidad" || x.sig === "Solicita demo");
    L.push(["Qué argumentos funcionan", `${P(pain / ms.length)} de las reuniones nacen cuando el contacto expresa un problema concreto o pide ver la solución; el resto acepta una reunión exploratoria.`, `n=${ms.length} reuniones con señal registrada. Interpretación: los argumentos anclados en un dolor específico abren más reuniones que la presentación general.`]);
  }
  const b = barrier(M);
  if (b.tot >= MIN_N) L.push(["Qué bloquea la conversión", `El principal cuello de botella está en ${b.main[0]} (${P(b.main[1] / b.tot)} de las cuentas cerradas sin avance), seguido de ${b.arr[1][0]} (${P(b.arr[1][1] / b.tot)}).`, `n=${b.tot} empresas trabajadas sin avance.`]);
  if (k.realization != null && M.held.length + M.noshow.length + M.canc.length >= 5) L.push(["Qué pasa después de agendar", `${P(1 - k.realization)} de las reuniones que debían ocurrir no se realizaron (no-show o cancelación).`, `${M.noshow.length} no-show y ${M.canc.length} canceladas sobre ${M.held.length + M.noshow.length + M.canc.length} reuniones con fecha pasada.`]);
  const fut = M.C.filter((c: any) => c.st === "Sin interés ahora - Retomar").length;
  if (fut >= 3) L.push(["Hay demanda diferida", `${fut} empresas dijeron "ahora no" y pidieron retomar: es demanda con fecha, no rechazo.`, `Estado "Sin interés ahora - Retomar".`]);
  return L.slice(0, 10);
}

export function recsBE(M: Model) {
  const R: [string, string, string][] = [], k = M.kpi, f = M.fu;
  if (k.phoneGap > 0.2) R.push(["Base de contactos", `Enriquecer teléfonos antes de asignar: ${P(k.phoneGap)} de los contactos gestionados terminó sin información de contacto.`, `${cnt(M.mg, (x: any) => x.st === "Sin Información de Contacto")} contactos en "Sin Información de Contacto".`]);
  const nc = cnt(M.mg, (x: any) => x.st === "No Contestó");
  if (nc / Math.max(1, M.mg.length) > 0.18) R.push(["Cadencias y canales", `Mover WhatsApp y LinkedIn antes del intento 5 en lugar de agotar 10 llamadas.`, `${nc} contactos (${P(nc / M.mg.length)}) llegaron a "No Contestó" tras 10 intentos.`]);
  if (k.multi != null && k.multi < 0.45) {
    const topA = seg(M, (x) => x.area).filter((a) => a.eff >= MIN_N).sort((a, b) => b.c2m - a.c2m).slice(0, 2).map((a) => a.key);
    R.push(["Multi-threading", `Abrir un segundo interlocutor en cada cuenta con conversación${topA.length ? ", priorizando " + topA.join(" y ") : ""}.`, `Solo ${P(k.multi)} de las empresas con contacto efectivo tiene 2+ interlocutores.`]);
  }
  if (f.K.length && (f.overdue.length + f.none.length) / f.K.length > 0.15) R.push(["Seguimiento", `Regularizar ${f.overdue.length} seguimientos vencidos y poner fecha a ${f.none.length} sin próxima acción.`, `${P((f.overdue.length + f.none.length) / f.K.length)} de los seguimientos no está al día.`]);
  if (M.ref.noChild.length) R.push(["Referrals", `Crear y llamar a los decisores referidos pendientes: ${M.ref.noChild.length} referrals no tienen contacto nuevo asociado.`, `Referral rate ${P(k.referralRate)}.`]);
  const ar = seg(M, (x) => x.area).filter((a) => a.eff >= MIN_N).sort((a, b) => b.c2m - a.c2m);
  if (ar.length >= 2) R.push(["Roles", `Priorizar ${ar[0].key}${ar[1] ? ` y ${ar[1].key}` : ""} en la asignación de Hot Calling.`, `Conversación→reunión ${ar.map((a) => `${a.key} ${P(a.c2m)}`).slice(0, 3).join(", ")}.`]);
  const bad = cnt(M.worked, (c: any) => ["No califica", "Gestionada - sin contactos fit", "Sin contactos - (ya nutrida)"].includes(c.st));
  if (bad / Math.max(1, M.worked.length) > 0.12) R.push(["ICP y segmentación", `Validar la lista con el cliente antes del próximo ciclo: ${P(bad / M.worked.length)} de las empresas trabajadas no calificó o no tenía contactos ICP.`, `${bad} empresas.`]);
  const ind = segCo(M, (c) => c.ind || "Sin industria").filter((s) => s.co >= 8).sort((a, b) => a.cov - b.cov)[0];
  if (ind && ind.cov < 0.8) R.push(["Priorización", `Acelerar ${ind.key}: es la industria con menor cobertura (${P(ind.cov)}).`, `${ind.pend} empresas aún en "Asignada".`]);
  if (k.realization != null && k.realization < 0.82) R.push(["Confirmación de reuniones", `Confirmar cada reunión 24 horas antes por WhatsApp y enviar recordatorio con agenda.`, `Realización ${P(k.realization)}.`]);
  return R;
}

export function recsCli(M: Model) {
  const R: [string, string, string][] = [], obs = M.K.filter((x: any) => x.obj), c = (o: string) => cnt(obs, (x: any) => x.obj === o), tot = Math.max(1, obs.filter((x: any) => x.obj !== "No es responsable").length);
  if (c("Ya tiene proveedor") / tot > 0.15) R.push(["Argumentos y casos de éxito", `Preparar casos de migración o complemento del proveedor actual y un argumento de "segundo proveedor".`, `"Ya tiene proveedor": ${c("Ya tiene proveedor")} objeciones (${P(c("Ya tiene proveedor") / tot)}).`]);
  if (c("Sin presupuesto") / tot > 0.12) R.push(["Pricing", `Ofrecer un formato de entrada de menor costo (piloto, diagnóstico acotado o pago por hito).`, `"Sin presupuesto": ${c("Sin presupuesto")} objeciones.`]);
  if ((c("Proyecto futuro") + c("Timing")) / tot > 0.15) R.push(["Contenido y nurturing", `Crear contenido para cuentas en espera (benchmark sectorial, checklist de planificación) y acordar fechas de retoma.`, `"Proyecto futuro" + "Timing": ${c("Proyecto futuro") + c("Timing")} objeciones.`]);
  if (c("No entiende propuesta de valor") >= 3) R.push(["Propuesta de valor", `Reescribir el pitch en una frase con resultado medible; hoy no se entiende la diferencia.`, `${c("No entiende propuesta de valor")} contactos dijeron no entender la propuesta.`]);
  if (c("Solución interna") / tot > 0.1) R.push(["Posicionamiento", `Posicionarse como refuerzo del equipo interno y no como reemplazo.`, `"Solución interna": ${c("Solución interna")} objeciones.`]);
  if (c("No necesidad") / tot > 0.15) R.push(["Segmentación", `Revisar el ICP con el cliente: parte del mercado no reconoce el problema que se resuelve.`, `"No necesidad": ${c("No necesidad")} objeciones.`]);
  const nofb = cnt(M.held, (m: any) => !m.fb || !m.res);
  if (M.held.length && nofb / M.held.length > 0.25) R.push(["Feedback post reunión", `Registrar resultado y feedback de cada reunión dentro de 48 horas; sin esto no se puede medir calidad ni oportunidad.`, `${nofb} de ${M.held.length} reuniones realizadas sin feedback o resultado.`]);
  const ind = segCo(M, (x) => x.ind || "Sin industria").filter((s) => !s.small).sort((a, b) => b.mRate - a.mRate)[0];
  if (ind) R.push(["Casos por industria", `Desarrollar un caso de éxito de ${ind.key}, el segmento que mejor responde, y usarlo en la cadencia.`, `Reunión por empresa trabajada en ${ind.key}: ${P(ind.mRate)}.`]);
  if (M.kpi.oppRate != null && M.coHeld.length >= 3 && M.kpi.oppRate < 0.3) R.push(["Paso siguiente en reunión", `Cerrar cada reunión con un próximo paso concreto (propuesta, workshop o demo con fecha).`, `Solo ${P(M.kpi.oppRate)} de las empresas con reunión realizada tiene oportunidad.`]);
  return R;
}

// Filtros globales del módulo: SDR, País, Industria y Wishlist recortan empresas y todo
// lo que cuelga de ellas (el universo pasa a ser el del filtro). El rango de
// fechas recorta lo que tiene fecha: reuniones (agendada o realizada en el
// rango), actividades y negocios; los status de empresas y contactos son los
// actuales, porque el snapshot no guarda su historia.
export const NO_IND = "Sin industria";
const normName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const NO_WL = "Fuera de la wishlist";
export type RadarFilter = { sdr?: string; pais?: string; ind?: string; wl?: string; from?: string; to?: string };

export function filterDataset(ds: RadarDataset, f: RadarFilter): RadarDataset {
  const byCo = !!(f.sdr || f.pais || f.ind || f.wl);
  const byDate = !!(f.from && f.to);
  if (!byCo && !byDate) return ds;
  let { companies, contacts, meetings, deals, activities, callEvals } = ds.client;
  if (byCo) {
    companies = companies.filter((c) => (!f.sdr || c.sdr === f.sdr) && (!f.pais || c.pais === f.pais) && (!f.ind || (c.ind || NO_IND) === f.ind) && (!f.wl || (c.wl || NO_WL) === f.wl));
    const ids = new Set(companies.map((c) => String(c.id)));
    const inCo = (x: { co: number | string }) => ids.has(String(x.co));
    contacts = contacts.filter(inCo);
    // Total de la planilla: solo SDR (responsable) y país, que la planilla tiene
    meetings = ds.client.meetingsTotal
      ? meetings.filter((m) => (!f.sdr || normName(m.sdr) === normName(f.sdr)) && (!f.pais || !m.pais || normName(m.pais) === normName(f.pais)))
      : meetings.filter(inCo);
    deals = deals.filter(inCo);
    if (activities) activities = activities.filter(inCo);
  }
  let period = ds.period;
  let trendBase: RadarDataset["trendBase"];
  const allMeetings = meetings;
  if (byDate) {
    const from = f.from!, to = f.to!;
    const inR = (d?: string | null) => !!d && d >= from && d <= to;
    meetings = meetings.filter((m) => inR(m.agendada) || inR(m.fecha));
    deals = deals.filter((d) => inR(d.created));
    if (callEvals) callEvals = callEvals.filter((e) => inR(e.d));
    if (activities) {
      // Conteos por contacto con las actividades del rango (igual que el sync)
      activities = activities.filter((a) => inR(a.d));
      const byCt = by(activities.filter((a) => a.ct != null), (a) => String(a.ct));
      contacts = contacts.map((k) => {
        const A = byCt[String(k.id)] || [];
        const calls = cnt(A, (a) => a.k === "call");
        return { ...k, att: calls, calls, conv: cnt(A, (a) => !!a.conn), wa: cnt(A, (a) => a.k === "wa"), li: cnt(A, (a) => a.k === "li"), em: cnt(A, (a) => a.k === "em") };
      });
    }
    // Reuniones y oportunidad de cada empresa dentro del rango
    const mBy = by(meetings, (m) => String(m.co));
    const openDeal = new Set(deals.filter((d) => d.stage !== "Perdido").map((d) => String(d.co)));
    companies = companies.map((c) => {
      const M = mBy[String(c.id)] || [], held = M.filter((m) => m.st === "Realizada");
      return { ...c, msch: M.length, mheld: held.length, opp: held.some((m) => m.res === "Oportunidad") || openDeal.has(String(c.id)) };
    });
    // La tendencia del Health Score sigue usando los meses completos
    trendBase = { period: ds.trendBase?.period ?? ds.period, agendadas: allMeetings.map((m) => m.agendada).filter(Boolean) };
    period = [from, to];
  }
  return {
    ...ds,
    period,
    ...(byDate ? { range: { from: f.from!, to: f.to! }, trendBase } : {}),
    client: {
      ...ds.client,
      ...(byCo ? { universe: companies.length, sdrs: f.sdr ? [f.sdr] : ds.client.sdrs } : {}),
      companies, contacts, meetings, deals,
      ...(activities ? { activities } : {}),
      ...(callEvals ? { callEvals: f.sdr ? callEvals.filter((e) => normName(e.s) === normName(f.sdr!)) : callEvals } : {}),
    },
  };
}

/* ---------- profundidad por canales (actividades de la cuenta) ---------- */
// Canales de contacto: los que cuentan para "multicanal" (las notas no son
// actividades).
export const CHANNELS: { k: string; l: string; c: string }[] = [
  { k: "call", l: "Llamadas", c: "var(--s1)" },
  { k: "wa", l: "WhatsApp", c: "var(--g-int)" },
  { k: "li", l: "LinkedIn", c: "var(--g-fut)" },
  { k: "em", l: "Correo", c: "var(--g-cont)" },
];

// Con datos de HubSpot se usan las actividades asociadas a la empresa o a sus
// contactos (sin duplicar); con datos demo, los conteos por contacto.
export function activityDepth(M: Model) {
  const acts: any[] | undefined = M.cl.activities;
  const fromActivities = Array.isArray(acts);
  const co = new Map((M.C as any[]).map((c) => [String(c.id), c]));
  M.C.forEach((c: any) => { c.ch = { call: 0, wa: 0, li: 0, em: 0 }; c.rep = 0; c.conn = 0; c.touched = new Set(); c.coOnly = 0; });
  if (fromActivities) {
    for (const a of acts!) {
      const c = co.get(String(a.co));
      if (!c || !(a.k in c.ch)) continue; // las notas no son actividades
      c.ch[a.k] = (c.ch[a.k] || 0) + 1;
      if (a.in) c.rep++;
      if (a.conn) c.conn++;
      if (a.ct != null) c.touched.add(String(a.ct)); else c.coOnly++;
    }
  } else {
    M.K.forEach((k: any) => {
      const c = k.c; if (!c) return;
      c.ch.call += k.calls || 0; c.ch.wa += k.wa || 0; c.ch.li += k.li || 0; c.ch.em += k.em || 0;
      if ((k.calls || 0) + (k.wa || 0) + (k.li || 0) + (k.em || 0)) c.touched.add(String(k.id));
    });
  }
  M.C.forEach((c: any) => {
    c.acts = sum(Object.values(c.ch), (v: any) => v);
    c.nch = CHANNELS.filter((x) => c.ch[x.k] > 0).length;
  });
  const worked = M.worked as any[], active = worked.filter((c) => c.acts > 0);
  const tot: Record<string, number> = {};
  for (const k of ["call", "wa", "li", "em"]) tot[k] = sum(M.C, (c: any) => c.ch[k]);
  // por mes (solo con fechas)
  const months = (M.B as Bucket[]).map((b) => {
    const row: Record<string, any> = { mo: b.k };
    for (const x of CHANNELS) row[x.k] = fromActivities ? cnt(acts!, (a) => a.k === x.k && inBucket(a.d, b)) : 0;
    return row;
  });
  return {
    fromActivities,
    dated: fromActivities && acts!.some((a) => a.d),
    total: sum(Object.values(tot), (v: any) => v),
    tot,
    active,
    perWorked: div(sum(worked, (c) => c.acts), worked.length),
    multi: div(cnt(active, (c) => c.nch >= 2), active.length),
    avgCh: div(sum(active, (c) => c.nch), active.length),
    touched: div(sum(active, (c) => c.touched.size), active.length),
    coOnly: sum(M.C, (c: any) => c.coOnly),
    replies: sum(M.C, (c: any) => c.rep),
    conn: sum(M.C, (c: any) => c.conn),
    byChannel: CHANNELS.map((x) => ({ ...x, cov: div(cnt(worked, (c) => c.ch[x.k] > 0), worked.length) || 0 })),
    byNch: [1, 2, 3, 4].map((n) => {
      const set = active.filter((c) => (n === 4 ? c.nch >= 4 : c.nch === n));
      return { n, count: set.length, mRate: div(cnt(set, (c) => c.M.length), set.length) || 0 };
    }),
    months,
  };
}
