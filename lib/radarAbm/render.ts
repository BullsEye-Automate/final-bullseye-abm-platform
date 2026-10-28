import { G, CO_G, CO_DEFS, CO_ORDER, CT_DEFS, CT_G, CT_ORDER, PAUSA, PEND, POS, REJ, MIN_N } from "./dictionaries";
import {
  type Model, esc, by, cnt, sum, div, P, N, F1, USD, dmy, addDays,
  seg, segCo, barrier, objectionPattern, insights, learnings, recsBE, recsCli, CHANNELS,
} from "./engine";

// Radar ABM — render de las secciones (§1 a §34 y A1 a A4) como HTML.
// Port del render() del prototipo: mismos textos, misma lógica y mismas
// clases (con prefijo ra- en el CSS del módulo, ver components/radar/radar.css,
// donde todo vive bajo .ra-root). Todo dato que viene de HubSpot pasa por
// esc() antes de entrar al HTML.


/* ---------- estructura del informe ---------- */
export type Part = [string, string, [number | string, string, string][]];
export const PARTS: Part[] = [
  ["I", "Visión ejecutiva", [[1, "resumen", "Resumen ejecutivo"], [2, "health", "Health Score"], [3, "kpis", "KPIs principales"]]],
  ["II", "Cuentas y contactos", [[4, "cobertura", "Cobertura de cuentas"], [5, "profundidad", "Profundidad ABM"], [6, "multi", "Multi-threading"], [7, "funnel", "Funnel ABM"], [8, "est-emp", "Estados de empresas"], [9, "est-ct", "Estados de contactos"]]],
  ["III", "Contacto y conversación", [[10, "contactab", "Contactabilidad"], [11, "conv", "Conversaciones"]]],
  ["IV", "Reuniones", [[12, "reuniones", "Reuniones agendadas vs realizadas"], [13, "calidad", "Calidad de reuniones"]]],
  ["V", "Potencial en curso", [[14, "seguimientos", "Seguimientos"], [15, "referrals", "Referrals"]]],
  ["VI", "Voz del mercado", [[16, "objeciones", "Objeciones"], [17, "senales", "Señales de interés"]]],
  ["VII", "Descarte e ICP", [[18, "descartadas", "Empresas descartadas"], [19, "icp", "Análisis ICP"]]],
  ["VIII", "Segmentos", [[20, "rol", "Análisis por rol"], [21, "industria", "Análisis por industria"], [22, "pais", "Análisis por país"], [23, "sdr", "Análisis por SDR"]]],
  ["IX", "Evolución y stock", [[24, "evolucion", "Evolución temporal"], [25, "stock-op", "Stock operativo"], [26, "stock-opp", "Stock de oportunidad"], [27, "recuperables", "Cuentas recuperables"]]],
  ["X", "Inteligencia", [[28, "inteligencia", "Inteligencia comercial"], [29, "aprendizajes", "Lo que aprendimos del mercado"], [30, "oportunidades", "Oportunidades detectadas"]]],
  ["XI", "Recomendaciones", [[31, "rec-be", "Recomendaciones BullsEye"], [32, "rec-cli", "Recomendaciones para el cliente"]]],
  ["XII", "Tablas maestras", [[33, "tm-emp", "Tabla maestra de empresas"], [34, "tm-ct", "Tabla maestra de contactos"]]],
  ["A", "Anexo · Validación de datos", [["A1", "datos-prop", "Propiedades y mapeo HubSpot"], ["A2", "datos-metr", "Qué se puede calcular"], ["A3", "datos-inc", "Inconsistencias detectadas"], ["A4", "datos-nuevas", "Propiedades a registrar"]]],
];

// Slug de cada vista (URLs del portal: /portal/radar/<slug>)
export const PART_SLUGS = [
  "vision-ejecutiva", "cuentas-contactos", "contacto-conversacion", "reuniones", "potencial", "voz-mercado",
  "descarte-icp", "segmentos", "evolucion-stock", "inteligencia", "recomendaciones", "tablas-maestras", "validacion-datos",
];

export const LEADS: Record<string, string> = {
  resumen: "Qué pasó con las cuentas, hasta dónde llegamos dentro de ellas y qué potencial queda abierto.",
  health: "Puntaje compuesto de 0 a 100. No se basa solo en reuniones.",
  kpis: "Indicadores de resultado arriba; actividad operativa abajo, solo como contexto.",
  cobertura: "¿Qué porcentaje del universo estamos trabajando?",
  profundidad: "¿Qué tan profundamente estamos penetrando cada empresa?",
  multi: "Cuántas cuentas tienen más de un interlocutor real y si eso se asocia a más reuniones.",
  funnel: "Cuenta → contacto → conversación → interés → reunión → oportunidad.",
  "est-emp": "Status de la asignación - SDR, con su grupo analítico. Ningún grupo es falla automática del SDR.",
  "est-ct": "Asignación BullsEye por Llamar, con su grupo analítico.",
  contactab: "¿Qué tan fácil es llegar a los interlocutores?",
  conv: "¿Qué ocurre cuando logramos hablar con alguien?",
  reuniones: "Agendadas ≠ realizadas. Reunión ≠ oportunidad.",
  calidad: "Clasificación solo cuando hay información suficiente.",
  seguimientos: "Separa el potencial vivo del trabajo atrasado.",
  referrals: "Contactos que nos derivan al decisor: una señal de penetración ABM.",
  objeciones: "Por qué dicen que no, quién lo dice y dónde se concentra.",
  senales: "Qué tipo de interés aparece y qué perfil lo muestra.",
  descartadas: "Por qué salen las cuentas: cada motivo es un problema distinto.",
  icp: "Ajuste de la base al perfil de cliente ideal.",
  rol: "Qué cargos responden, convierten, rechazan o derivan.",
  industria: "Resultados por industria en tasas comparables.",
  pais: "Cada mercado se lee por separado.",
  sdr: "Resultados y disciplina operativa, sin penalizar problemas estructurales de la base.",
  evolucion: "Tendencia mensual del periodo.",
  "stock-op": "¿Cuánto trabajo pendiente existe?",
  "stock-opp": "¿Cuánto potencial comercial está vivo?",
  recuperables: "Cuentas que no deben considerarse perdidas.",
  inteligencia: "Patrones detectados en los datos. Cada uno indica el dato que lo sustenta y la interpretación por separado.",
  aprendizajes: "Lo que el mercado nos está diciendo, más allá de los KPIs.",
  oportunidades: "Cuentas priorizadas por fit, interés, profundidad y avance.",
  "rec-be": "Qué cambiar en la operación de BullsEye. Cada recomendación se activa por un umbral en los datos.",
  "rec-cli": "Qué debería ajustar el cliente en su propuesta y argumentos.",
  "tm-emp": "Una fila por empresa.", "tm-ct": "Una fila por contacto.",
  "datos-prop": "Pasos 1 a 3: estructura de datos y propiedades.", "datos-metr": "Pasos 4 y 5.",
  "datos-inc": "Paso 6: chequeos automáticos sobre los datos del cliente seleccionado.", "datos-nuevas": "Paso 7: qué empezar a registrar para mejorar el reporting.",
};

/* ---------- componentes visuales ---------- */
type BarItem = { l: string; v: number; c?: string; r?: string | null; tip?: string };
export function bars(items: BarItem[], opt: { max?: number; pct?: boolean | number } = {}) {
  const max = opt.max || Math.max(1, ...items.map((i) => i.v));
  return `<div class="bars">${items.map((i) => `<div class="bar" data-tip="${esc(i.tip || (i.l + ": " + (opt.pct ? P(i.v, 1) : N(i.v))))}">
    <div class="l">${i.c ? `<span class="dot" style="background:${i.c}"></span>` : ""}${esc(i.l)}</div>
    <div class="t"><i style="width:${(i.v / max * 100).toFixed(2)}%;background:${i.c || "var(--s1)"}"></i></div>
    <div class="r">${opt.pct ? P(i.v, 0) : N(i.v)}${i.r != null ? ` <em>${i.r}</em>` : ""}</div></div>`).join("")}</div>`;
}
export function stack(items: { l: string; v: number; c: string }[]) {
  const tot = sum(items, (i) => i.v) || 1;
  return `<div class="stack">${items.filter((i) => i.v).map((i) => `<i style="width:${i.v / tot * 100}%;background:${i.c}" data-tip="${esc(i.l)}: ${N(i.v)} (${P(i.v / tot)})"></i>`).join("")}</div>
  <div class="legend">${items.filter((i) => i.v).map((i) => `<span><span class="dot" style="background:${i.c}"></span>${esc(i.l)} <b class="num">${N(i.v)}</b> <span class="num" style="color:var(--muted)">${P(i.v / tot)}</span></span>`).join("")}</div>`;
}
const IP: Record<string, string> = {
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  msg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
};
export const ic = (n: string, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IP[n] || ""}</svg>`;
export function tile(k: string, v: string, d?: string, ctx?: string | number, ico?: string, sm?: string) {
  const cls = ctx === "hl" ? " hl" : ctx ? " ctx" : "";
  return `<div class="tile${cls}"><span class="k">${ico ? `<span class="kic ${sm || ""}">${ic(ico, 15)}</span>` : ""}<span>${k}</span></span><span class="v">${v}</span>${d ? `<span class="d">${d}</span>` : ""}</div>`;
}
export type Col = { h: string; f: (r: any) => any; n?: number | boolean; s?: number | boolean };
export function table(cols: Col[], rows: any[], opt: { dim?: (r: any) => boolean } = {}) {
  return `<div class="tw"><table><thead><tr>${cols.map((c) => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr class="${opt.dim && opt.dim(r) ? "dim" : ""}">${cols.map((c) => `<td class="${c.n ? "n" : ""}${c.s ? " small" : ""}">${c.f(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="flag">Sin registros</td></tr>`}</tbody></table></div>`;
}
export const pill = (q: string) => ({ hi: '<span class="pill hi">Alta</span>', md: '<span class="pill md">Media</span>', lo: '<span class="pill lo">Baja</span>', na: '<span class="pill na">Sin info suficiente</span>' } as Record<string, string>)[q] || "";
export const prioPill = (p: string) => (p === "Alta" ? pill("hi") : p === "Media" ? pill("md") : p === "Baja" ? pill("lo") : '<span class="flag">—</span>');
const small = (r: any) => (r.small ? ' <span class="flag">muestra chica</span>' : "");
const H = (t: string) => `<span class="kind h">Hecho</span>${t}`;
const I = (t: string) => `<span class="kind i">Interpretación</span>${t}`;

function lineChart(series: { n: string; c: string; v: number[] }[], labels: string[]) {
  const W = 640, Hh = 220, pl = 34, pr = 14, pt = 14, pb = 28;
  const max = Math.max(4, ...series.flatMap((s) => s.v)); const nice = Math.ceil(max / 4) * 4;
  const span = Math.max(1, labels.length - 1);
  const x = (i: number) => pl + i * (W - pl - pr) / span, y = (v: number) => pt + (Hh - pt - pb) * (1 - v / nice);
  let g = "";
  for (let t = 0; t <= 4; t++) { const v = nice / 4 * t; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`; }
  labels.forEach((l, i) => (g += `<text x="${x(i)}" y="${Hh - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${l}</text>`));
  series.forEach((s) => {
    g += `<polyline fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round" points="${s.v.map((v, i) => x(i) + "," + y(v)).join(" ")}"/>`;
    s.v.forEach((v, i) => (g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === s.v.length - 1 ? 4.5 : 3}" fill="${s.c}" stroke="var(--panel)" stroke-width="2"/>`));
  });
  labels.forEach((l, i) => {
    const tip = `${l.replace("*", "")}: ` + series.map((s) => `${s.n} ${s.v[i]}`).join(" · ");
    g += `<rect x="${x(i) - (W - pl - pr) / span / 2}" y="${pt}" width="${(W - pl - pr) / span}" height="${Hh - pt - pb}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Evolución mensual">${g}</svg></div>
  <div class="legend">${series.map((s) => `<span><span class="dot" style="background:${s.c}"></span>${s.n}</span>`).join("")}</div>`;
}
function gauge(score: number, band: [string, string]) {
  const r = 84, c = 2 * Math.PI * r, col = band[1] === "hi" ? "var(--good)" : band[1] === "md" ? "var(--warn)" : "var(--bad)";
  return `<div class="gauge"><svg viewBox="0 0 200 200" width="200" height="200"><circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="16"/>
  <circle cx="100" cy="100" r="${r}" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${c * score / 100} ${c}" transform="rotate(-90 100 100)" stroke-linecap="round"/></svg>
  <div class="c"><b>${score}</b><span>de 100</span></div></div>`;
}
const topN = (arr: any[], f?: ((x: any) => boolean) | null, n = 2) => {
  const c = by(arr.filter(f ? f : () => true), (x) => x);
  return Object.entries(c).sort((a, b) => b[1].length - a[1].length).slice(0, n).map(([k, v]) => `${esc(k)} (${v.length})`).join(", ") || "—";
};

export function sec(no: number | string, id: string, title: string, lead: string, body: string) {
  return `<section class="s" id="${id}"><div class="s-h"><span class="no">§${no}</span><h3>${title}</h3></div>${lead ? `<p class="lead">${lead}</p>` : ""}<div class="body">${body}</div></section>`;
}

// Nota del mes en curso (en el prototipo: "Septiembre parcial")
const partialNote = (M: Model) => (M.partial ? `* ${M.gran === "week" ? "Semana del " : ""}${M.MLAB[M.MONTHS[M.MONTHS.length - 1]].replace("*", "")} parcial (corte ${dmy(M.TODAY)}). ` : "");
// "por mes" / "por semana" / "por día" según el tramo de las series
const perUnit = (M: Model) => ({ month: "por mes", week: "por semana", day: "por día" } as Record<string, string>)[M.gran] || "por mes";
const evoTitle = (M: Model) => ({ month: "Evolución mensual", week: "Evolución semanal", day: "Evolución diaria" } as Record<string, string>)[M.gran] || "Evolución mensual";
const monthLabels = (M: Model) => M.MONTHS.map((m: string) => M.MLAB[m]);

/* ---------- profundidad por canales ---------- */
function channelDepth(M: Model): string {
  const ad = M.ad;
  const mix = CHANNELS.map((x) => ({ l: x.l, v: ad.tot[x.k] || 0, c: x.c }));
  const extra = ad.fromActivities
    ? `${tile("Correos respondidos", N(ad.replies), "correos entrantes del contacto")}${tile("Llamadas conectadas", N(ad.conn), "“Resultado de la llamada” = Conectad…")}`
    : "";
  return `<div class="rcard" style="margin-top:14px"><h4>Profundidad por canales</h4>
  <div class="tiles">${tile("Actividades por empresa trabajada", F1(ad.perWorked), `${N(ad.total)} actividades en total`)}${tile("Empresas multicanal", P(ad.multi), "2+ canales entre las empresas con actividad")}${tile("Canales por empresa", F1(ad.avgCh), "promedio entre empresas con actividad")}${tile("Contactos tocados por empresa", F1(ad.touched), "contactos con al menos una actividad")}${extra}</div>
  <div class="grid2" style="margin-top:14px"><div><h4>Mezcla de canales</h4>${ad.total ? stack(mix) : '<p class="note" style="margin-top:0">Sin actividades registradas.</p>'}</div>
  <div><h4>Empresas trabajadas con actividad por canal</h4>${bars(ad.byChannel.map((x: any) => ({ l: x.l, v: x.cov, c: x.c })), { pct: 1, max: 1 })}</div></div>
  <h4 style="margin-top:16px">% de empresas con reunión según canales usados</h4>${bars(ad.byNch.filter((x: any) => x.count).map((x: any) => ({ l: `${x.n === 4 ? "4 o más" : x.n} canal${x.n === 1 ? "" : "es"} (n=${x.count})`, v: x.mRate, c: "var(--g-int)" })), { pct: 1, max: 1 })}
  <p class="note">${ad.fromActivities ? `Actividades asociadas a la empresa o a sus contactos, contadas una sola vez (${N(ad.coOnly)} registradas solo en la empresa). Llamadas con “Tipo de llamada” WhatsApp o LinkedIn cuentan en ese canal.` : "Datos demo: conteos por contacto (sin actividades registradas solo en la empresa ni fechas)."} Relación descriptiva, no causal.</p></div>`;
}

/* ---------- render de secciones ---------- */
export function render(M: Model, mapping?: { label: string; property: string | null }[] | null): Record<string, string> {
  const k = M.kpi, h = M.health, cl = M.cl, C: any[] = M.C, K: any[] = M.K, f = M.fu, rf = M.ref, TODAY: string = M.TODAY;
  const s: Record<string, string> = {};
  const b = barrier(M);
  const liveCo = C.filter((c) => c.st === "En seguimiento" || c.M.some((m: any) => m.st === "Pendiente" || m.st === "Reprogramada") || c.K.some((x: any) => x.st === "Refiere con el Tomador de Decisiones" && !rf.refd.some((y: any) => y.refBy === x.id)));
  const d30 = addDays(TODAY, -30);
  const defs = M.cfg?.definitions ?? { companies: CO_DEFS, contacts: CT_DEFS };

  s.resumen = `<div class="exec"><ul>
    <li>Trabajamos <b>${N(k.worked)} de ${N(k.universe)}</b> empresas objetivo (${P(k.coverage)} de cobertura) y logramos conversación efectiva con <b>${N(M.eff.length)} contactos</b> en <b>${N(M.coEff.length)} empresas</b>.</li>
    <li>Se agendaron <b>${N(M.Mt.length)} reuniones</b> en ${N(M.coMt.length)} empresas (${F1(k.mPerAcc)} por empresa con reunión). Se realizaron <b>${N(M.held.length)}</b> (${P(k.realization)} de realización) y hay ${N(M.pendM.length)} pendientes.</li>
    <li>Profundidad: <b>${P(k.multi)}</b> de las empresas con contacto tiene 2 o más interlocutores y ${P(k.deep)} tiene cobertura profunda (3+ contactos o varias áreas).</li>
    ${b.tot ? `<li>${b.main[0] === "rechazo explícito" ? "La principal barrera es el rechazo explícito" : `La principal barrera no es el rechazo sino <b>${b.main[0]}</b>`} (${P(b.main[1] / b.tot)} de las empresas trabajadas sin avance).</li>` : ""}
    <li>Potencial vivo: <b>${N(liveCo.length)} empresas</b> con seguimiento activo, reunión próxima o referral por trabajar; ${N(C.filter((c) => c.st === "Sin interés ahora - Retomar").length)} más pidieron retomar más adelante.</li>
    <li>${M.pipe ? `Oportunidades: <b>${N(k.opp)} ${k.opp === 1 ? "empresa" : "empresas"}</b> con oportunidad; pipeline abierto ${USD(M.pipe.open)}${M.pipe.won ? ` y ${USD(M.pipe.won)} ganado` : ""}.` : `Oportunidades: ${N(k.opp)} empresas con reunión que terminó en oportunidad. Pipeline: <b>sin información disponible</b> (el cliente no registra negocios en HubSpot).`}</li>
    ${f.overdue.length + f.none.length ? `<li>Alerta operativa: <b>${N(f.overdue.length)} seguimientos vencidos</b> y ${N(f.none.length)} sin próxima acción.</li>` : ""}
  </ul></div><p class="note">Universo: ${cl.deep ? "cartera acotada de cuentas estratégicas; la lectura se centra en profundidad por cuenta más que en volumen." : "universo amplio; la lectura combina cobertura y profundidad."} SDR: ${esc(cl.sdrs.join(", ") || "—")}.</p>`;

  s.health = `<div class="health"><div>${gauge(h.score, h.band)}<p style="margin:10px 0 0;text-align:center">${pill(h.band[1]).replace(/Alta|Media|Baja/, h.band[0])}</p></div>
  <div>${table([{ h: "Componente", f: (c) => esc(c.n) }, { h: "Peso", n: 1, f: (c) => (c.s == null ? `<s>${c.w}</s>` : c.w) }, { h: "Valor", n: 1, f: (c) => P(c.v) }, { h: "Meta", n: 1, f: (c) => P(c.t) }, { h: "Puntaje", n: 1, f: (c) => (c.s == null ? '<span class="flag">sin datos</span>' : Math.round(c.s)) }, { h: "Fórmula", s: 1, f: (c) => esc(c.f) }], h.comp, { dim: (c) => c.s == null })}
  <p class="note">Metodología: cada componente se expresa como avance hacia su meta (valor ÷ meta, tope 100) y se pondera por su peso. Los componentes sin datos suficientes se excluyen y el resto se re-pondera (peso usado: ${h.wt} de ${sum(h.comp, (c: any) => c.w)}). Saludable ≥ 75 · Requiere atención 55–74 · En riesgo &lt; 55. Las metas son supuestos iniciales a calibrar con histórico real de BullsEye; el puntaje no sirve para comparar clientes con universos o ICP distintos.</p></div></div>`;

  const acts = M.ad.fromActivities ? M.ad.total : sum(K, (x) => (x.calls || 0) + (x.wa || 0) + (x.li || 0) + (x.em || 0)), calls = M.ad.fromActivities ? M.ad.tot.call : sum(K, (x) => x.calls || 0);
  s.kpis = `<div class="tiles">
    ${tile("Cobertura de cuentas", P(k.coverage), `${N(k.worked)} de ${N(k.universe)} empresas`, "hl", "target")}
    ${tile("Contactabilidad", P(k.contactRate), "efectivos / gestionados", "", "phone")}
    ${tile("Multi-threading", P(k.multi), "empresas con 2+ interlocutores", "", "users")}
    ${tile("Conversación → reunión", P(k.convToMeet), "empresas con reunión / con conversación", "", "msg")}
    ${tile("Reuniones agendadas", N(M.Mt.length), `${N(M.coMt.length)} empresas`, "", "cal")}
    ${tile("Reuniones realizadas", N(M.held.length), `realización ${P(k.realization)}`, "", "check", k.realization >= 0.85 ? "g" : k.realization >= 0.7 ? "y" : "r")}
    ${tile("Referral rate", P(k.referralRate), `${rf.refs.length} referrals`, "", "split")}
    ${tile("Oportunidades", N(k.opp), M.pipe ? `pipeline abierto ${USD(M.pipe.open)}` : "pipeline sin información", "", "star")}
  </div>
  <div class="ctxh">Contexto operativo · no son indicadores de éxito</div>
  <div class="tiles">${tile("Empresas asignadas", N(C.length), "", 1)}${tile("Contactos en base", N(K.length), "", 1)}${tile("Actividades registradas", N(acts), `${N(calls)} llamadas`, 1)}${tile("Actividades por conversación", F1(div(acts, M.eff.length)), "esfuerzo para lograr 1 contacto efectivo", 1)}</div>`;

  const covInd = segCo(M, (c) => c.ind || "Sin industria");
  s.cobertura = `<div class="grid2"><div class="rcard"><h4>Universo de cuentas</h4>${stack([{ l: "Trabajadas", v: k.worked, c: "var(--accent)" }, { l: "Asignadas sin gestión", v: k.universe - k.worked, c: "var(--g-pend)" }])}
    <p class="note">Cuenta trabajada = empresa con estado distinto de "Asignada". Empresas asignadas hace más de 30 días sin gestión: <b>${N(cnt(C, (c) => c.st === "Asignada" && c.asg < d30))}</b>.</p></div>
    <div class="rcard"><h4>Cobertura por industria</h4>${bars(covInd.map((x) => ({ l: `${x.key} (${x.co})`, v: x.cov, c: "var(--s1)", tip: `${x.key}: ${x.worked} de ${x.co} trabajadas` })), { pct: 1, max: 1 })}</div></div>`;

  const depthOrder = ["Profunda", "Multi-thread", "Single-thread", "Sin contacto efectivo"], depthC: Record<string, string> = { "Profunda": "var(--g-int)", "Multi-thread": "var(--s1)", "Single-thread": "var(--g-disp)", "Sin contacto efectivo": "var(--g-pend)" };
  const qualWorked = M.worked.filter((c: any) => c.st !== "No califica");
  s.profundidad = `<div class="tiles">${tile("Contact penetration", P(k.penetration), "contactos gestionados / contactos ICP disponibles")}${tile("Contactos por empresa", F1(div(K.length, C.length)), "promedio en base")}${tile("Efectivos por empresa con contacto", F1(div(M.eff.length, M.coEff.length)), "interlocutores reales")}${tile("Reuniones por empresa", F1(k.mPerAcc), "entre empresas con reunión")}${tile("Reuniones por contacto efectivo", F1(k.mPerCt), "")}${tile("Interlocutores distintos", F1(k.interlocutors), "por empresa con reunión")}</div>
  <div class="rcard" style="margin-top:14px"><h4>Profundidad de las empresas trabajadas que califican (n=${qualWorked.length})</h4>${stack(depthOrder.map((d) => ({ l: d, v: cnt(qualWorked, (c: any) => c.depth === d), c: depthC[d] })))}
  <p class="note">Profunda = 3+ contactos efectivos o 2+ efectivos en áreas distintas · Multi-thread = 2+ efectivos · Single-thread = 1.</p></div>
  ${channelDepth(M)}`;

  const dist = [0, 1, 2, 3, 4].map((n) => ({ n, C: C.filter((c) => (n === 4 ? c.effK.length >= 4 : c.effK.length === n)) }));
  s.multi = `<div class="tiles">${tile("Multi-threading", P(k.multi), `${M.coMulti.length} de ${M.coEff.length} empresas con contacto`)}${tile("Deep multi-threading", P(k.deep), `${M.coDeep.length} empresas`)}${tile("Áreas distintas por empresa", F1(div(sum(M.coEff, (c: any) => (c.areas ? c.areas.length : 0)), M.coEff.length)), "promedio entre empresas con contacto")}</div>
  <div class="grid2" style="margin-top:14px"><div class="rcard"><h4>Empresas según número de contactos efectivos</h4>${bars(dist.map((d) => ({ l: d.n === 4 ? "4 o más" : d.n === 0 ? "Ninguno" : String(d.n), v: d.C.length, c: "var(--s1)" })))}</div>
  <div class="rcard"><h4>% de empresas con reunión según profundidad</h4>${bars(dist.filter((d) => d.n > 0).map((d) => ({ l: (d.n === 4 ? "4 o más" : d.n) + ` (n=${d.C.length})`, v: div(cnt(d.C, (c: any) => c.M.length), d.C.length) || 0, c: "var(--g-int)" })), { pct: 1, max: 1 })}<p class="note">Relación descriptiva; con pocos casos por barra no debe leerse como causalidad.</p></div></div>`;

  const fsteps: [string, string, number | null][] = [
    ["Empresas objetivo", "universo del cliente", C.length], ["Empresas asignadas", "con status de asignación", C.length], ["Empresas en gestión", "estado distinto de Asignada", k.worked],
    ["Empresas con contacto", "1+ contacto efectivo", M.coEff.length], ["Conversaciones", "con interlocutor relevante (excluye No Fit)", cnt(C, (c) => c.conv)],
    ["Interés", "reunión, seguimiento o referral", cnt(C, (c) => c.pos)], ["Reuniones agendadas", "empresas", M.coMt.length], ["Reuniones realizadas", "empresas", M.coHeld.length],
    ["Oportunidades", "empresas", k.opp], ["Pipeline / negocio", M.pipe ? `${M.pipe.n} negocios registrados` : "sin información disponible", M.pipe ? M.pipe.open + M.pipe.won : null]];
  const fmax = C.length || 1;
  s.funnel = `<div class="rcard"><div class="fun">${fsteps.map((st, i) => {
    const v = st[2], prev = i ? fsteps[i - 1][2] : null, isMoney = i === 9;
    const w = v == null ? 100 : isMoney ? 60 : 36 + 64 * v / fmax, col = isMoney ? "var(--good)" : `color-mix(in srgb, var(--accent) ${100 - i * 11}%, var(--teal))`;
    const conv = i > 2 && i < 9 && prev != null && v != null ? `<div class="fconv">↓ <b>${P(div(v, prev))}</b> pasa desde la etapa anterior</div>` : i > 0 ? `<div class="fconv" style="height:6px;padding:0"></div>` : "";
    return `${conv}<div class="fst"><div class="fbar${v == null ? " na" : ""}" style="width:${w}%;background:${col}" data-tip="${esc(st[0] + ": " + st[1])}"><span>${st[0]}<small>${st[1]}</small></span><b>${v == null ? "Sin información" : isMoney ? USD(v) : N(v)}</b></div></div>`;
  }).join("")}</div></div>
  <p class="note">Unidad: empresas (salvo pipeline, en dólares). A nivel contacto: ${N(M.mg.length)} gestionados → ${N(M.eff.length)} efectivos → ${N(cnt(K, (x) => POS.has(x.st)))} con resultado positivo → ${N(cnt(K, (x) => x.st === "Reunión Agendada"))} con reunión.</p>`;

  const coCount = by(C, (c) => c.key);
  const coMax = Math.max(1, ...Object.values(coCount).map((a) => a.length));
  s["est-emp"] = table([{ h: "Estado", f: (r) => `<span style="display:inline-flex;gap:6px;align-items:center"><span class="dot" style="background:${G[CO_G[r][0]].c}"></span>${esc(r === "CONV" ? `En conversaciones con ${cl.name}` : r)}</span>` },
    { h: "Empresas", n: 1, f: (r) => N((coCount[r] || []).length) }, { h: "%", n: 1, f: (r) => P((coCount[r] || []).length / C.length) },
    { h: "", f: (r) => `<div class="bar" style="grid-template-columns:1fr"><div class="t" style="min-width:90px"><i style="width:${(coCount[r] || []).length / coMax * 100}%;background:${G[CO_G[r][0]].c}"></i></div></div>` },
    { h: "Grupo analítico", s: 1, f: (r) => CO_G[r].map((g) => G[g].l).join(" + ") },
    { h: "Qué significa", s: 1, f: (r) => esc(defs.companies[r] ?? "") }], CO_ORDER.filter((r) => coCount[r]))
    + `<div class="grid2" style="margin-top:14px"><div class="rcard"><h4>Destino de las cuentas trabajadas (n=${M.worked.length})</h4>${stack(([
      ["Reunión", (c: any) => c.st === "Reunión Agendada", "var(--g-int)"], ["Seguimiento", (c: any) => c.st === "En seguimiento", "var(--s1)"], ["Conversación existente", (c: any) => c.key === "CONV", "var(--g-rel)"], ["Cliente existente", (c: any) => c.st === "Clientes", "var(--g-rel)"],
      ["Retomar", (c: any) => c.st === "Sin interés ahora - Retomar", "var(--g-fut)"], ["En gestión / LinkedIn", (c: any) => c.st === "En gestión" || c.st === "Gestionada por LinkedIn", "var(--g-act)"], ["No interesados", (c: any) => c.st === "No interesados", "var(--g-rej)"],
      ["Sin comunicación / nutrir", (c: any) => c.st === "Gestionada - sin comunicación" || c.st === "Nutrir", "var(--g-cont)"], ["Sin contactos fit", (c: any) => c.st.includes("sin contactos fit") || c.st.startsWith("Sin contactos"), "var(--g-disp)"], ["No califica", (c: any) => c.st === "No califica", "var(--g-icp)"], ["Empresa ya nutrida", (c: any) => c.st === "Empresa ya nutrida", "var(--g-rec)"],
    ] as [string, (c: any) => boolean, string][]).map(([l, fn, c]) => ({ l, v: cnt(M.worked, fn), c })))}</div>
    <div class="rcard"><h4>Lectura</h4><ul class="clean"><li>${H(`${P(div(cnt(M.worked, (c: any) => ["Reunión Agendada", "En seguimiento"].includes(c.st) || c.key === "CONV"), M.worked.length))} de las cuentas trabajadas terminó en reunión, seguimiento o conversación existente.`)}</li>
    <li>${H(`${P(div(cnt(M.worked, (c: any) => c.st === "No interesados"), M.worked.length))} terminó en rechazo explícito; ${P(div(cnt(M.worked, (c: any) => ["Gestionada - sin comunicación", "Nutrir"].includes(c.st)), M.worked.length))} por no lograr comunicación.`)}</li>
    <li>${I("Los estados de contactabilidad, disponibilidad y ajuste ICP no son fallas del SDR: señalan calidad de base o de canal.")}</li></ul>
    <p class="note">"Nutrir", "Sin contactos - (ya nutrida)", "Gestionada por LinkedIn" y "En conversaciones con [cliente]" pertenecen a dos grupos; el color usa el primero.</p></div></div>`;

  const ctCount = by(K, (x) => x.st);
  s["est-ct"] = `<div class="grid2"><div class="rcard"><h4>Contactos por estado (n=${K.length})</h4>${bars(CT_ORDER.filter((x) => ctCount[x]).map((x) => ({ l: x, v: ctCount[x].length, c: G[CT_G[x]].c, r: P(ctCount[x].length / K.length), tip: `${x}: ${N(ctCount[x].length)}. ${defs.contacts[x] ?? ""}` })))}</div>
  <div class="rcard"><h4>Por grupo analítico</h4>${bars(["pend", "pos", "rej", "cont", "dispc", "cal", "canal", "pausa"].map((g) => ({ l: G[g].l, v: cnt(K, (x) => CT_G[x.st] === g), c: G[g].c })))}
  <p class="note">Pasa el cursor por cada estado para ver su definición oficial. No Contestó ≠ No Interesado · Sin Información de Contacto ≠ rechazo · Contacto No Fit ≠ empresa fuera de ICP. "${PAUSA}" no tiene grupo oficial en el diccionario; se muestra aparte (ver Anexo A3).</p></div></div>`;

  const snR = seg(M, (x) => x.sen);
  s.contactab = `<div class="tiles">${tile("Contacto efectivo", P(k.contactRate), `${N(M.eff.length)} de ${N(M.mg.length)} gestionados`)}${tile("Sin información de contacto", P(k.phoneGap), "problema de disponibilidad, no de interés")}${tile("No contestó (10 intentos)", P(div(cnt(M.mg, (x: any) => x.st === "No Contestó"), M.mg.length)), "problema de contactabilidad")}${tile("Pasaron a LinkedIn", P(div(cnt(M.mg, (x: any) => x.st === "En Gestión LinkedIn"), M.mg.length)), "cambio de canal")}</div>
  <div class="grid2" style="margin-top:14px"><div class="rcard"><h4>Contacto efectivo por seniority</h4>${bars(snR.map((r) => ({ l: `${r.key} (n=${r.mg})`, v: r.cr || 0, c: "var(--s1)" })), { pct: 1, max: 1 })}</div>
  <div class="rcard"><h4>Contacto efectivo por tamaño de empresa</h4>${bars(seg(M, (x) => x.c.size).map((r) => ({ l: `${r.key} (n=${r.mg})`, v: r.cr || 0, c: "var(--s1)" })), { pct: 1, max: 1 })}<p class="note">Base: contactos gestionados (con al menos un intento o estado final).</p></div></div>`;

  const effBy = by(M.eff as any[], (x) => x.st);
  s.conv = `<p class="note" style="margin-top:0">Conversación = contacto efectivo: la persona atendió y hubo intercambio. Una llamada sin respuesta es actividad, no conversación.</p>
  <div class="grid2"><div class="rcard"><h4>Resultado de las ${N(M.eff.length)} conversaciones</h4>${bars(["Reunión Agendada", "Hacer Seguimiento", "Refiere con el Tomador de Decisiones", "Gestionado - No Interesado", "Contacto No Fit para gestión", "NO gestionar"].map((x) => ({ l: x, v: (effBy[x] || []).length, c: G[CT_G[x]].c, r: P(div((effBy[x] || []).length, M.eff.length)) })))}</div>
  <div class="rcard"><h4>Conversaciones por empresa</h4><div class="tiles">${tile("Conversaciones por empresa con contacto", F1(div(M.eff.length, M.coEff.length)))}${tile("% conversaciones con resultado positivo", P(div(cnt(M.eff, (x: any) => POS.has(x.st)), M.eff.length)))}</div>
  <p class="note">Canal de las conversaciones: llamadas ${N(sum(M.eff, (x: any) => x.calls || 0))}, WhatsApp ${N(sum(M.eff, (x: any) => x.wa || 0))}, correo ${N(sum(M.eff, (x: any) => x.em || 0))} (actividades asociadas a contactos efectivos). El canal exacto en que ocurrió la conversación no se registra hoy (ver Anexo A4).</p></div></div>`;

  const mst: [string, string][] = [["Realizada", "var(--g-int)"], ["Pendiente", "var(--s1)"], ["Reprogramada", "var(--g-act)"], ["No-show", "var(--g-cont)"], ["Cancelada", "var(--g-rej)"]];
  const res: [string | null, string][] = [["Oportunidad", "var(--g-int)"], ["Seguimiento", "var(--s1)"], ["Sin avance", "var(--g-disp)"], ["Descartada", "var(--g-rej)"], [null, "var(--g-pend)"]];
  s.reuniones = `<div class="tiles">${tile("Agendadas", N(M.Mt.length))}${tile("Realizadas", N(M.held.length))}${tile("Pendientes", N(M.pendM.length))}${tile("No-show", N(M.noshow.length))}${tile("Canceladas", N(M.canc.length))}${tile("Reprogramadas", N(M.reprog.length), "incluye las ya realizadas")}${tile("Tasa de realización", P(k.realization), "sobre reuniones con fecha pasada")}${tile("Empresas con reunión", N(M.coMt.length), `${F1(k.mPerAcc)} reuniones por empresa`)}${tile("Contactos con reunión", N(new Set(M.Mt.map((m: any) => m.ct)).size), `${F1(k.interlocutors)} interlocutores por empresa`)}</div>
  <div class="grid2" style="margin-top:14px"><div class="rcard"><h4>Estado de las ${M.Mt.length} reuniones agendadas</h4>${stack(mst.map(([l, c]) => ({ l, v: cnt(M.Mt, (m: any) => m.st === l), c })))}</div>
  <div class="rcard"><h4>Qué pasó después de las ${M.held.length} realizadas</h4>${bars(res.map(([l, c]) => ({ l: l || "Sin información de resultado", v: cnt(M.held, (m: any) => (m.res || null) === l), c })))}<p class="note">Agendada ≠ realizada, y reunión ≠ oportunidad: solo se cuenta oportunidad cuando hay resultado registrado o un negocio asociado.</p></div></div>
  ${M.pipe ? `<div class="rcard" style="margin-top:14px"><h4>Pipeline asociado (${M.pipe.n} negocios)</h4>${bars(["Calificación", "Propuesta enviada", "Negociación", "Ganado", "Perdido"].map((st) => ({ l: st, v: sum(M.pipe.byStage[st] || [], (d: any) => d.amount), c: st === "Perdido" ? "var(--g-rej)" : st === "Ganado" ? "var(--g-rel)" : "var(--s1)", r: `(${(M.pipe.byStage[st] || []).length})`, tip: `${st}: ${USD(sum(M.pipe.byStage[st] || [], (d: any) => d.amount))}` })))}<p class="note">Montos en dólares; barras en miles.</p></div>` : `<p class="note">Pipeline: sin información disponible para este cliente.</p>`}
  <div class="rcard" style="margin-top:14px"><h4>${evoTitle(M)}</h4>${lineChart([{ n: "Agendadas", c: "var(--s1)", v: M.month.map((m: any) => m.sch) }, { n: "Realizadas", c: "var(--s2)", v: M.month.map((m: any) => m.held) }], monthLabels(M))}<p class="note">${partialNote(M)}Agendadas por fecha de agendamiento; realizadas por fecha de la reunión.</p></div>`;

  const qd = by(M.held as any[], (m) => m.q), yn = (v: any) => (v === true ? "Sí" : v === false ? "No" : '<span class="flag">s/i</span>');
  s.calidad = `<div class="tiles">${["hi", "md", "lo", "na"].map((q) => tile(pill(q), N((qd[q] || []).length), P(div((qd[q] || []).length, M.held.length)))).join("")}</div>
  <p class="note">Criterios por reunión realizada: empresa en ICP (A/B), contacto correcto (gerente o superior en área decisora), necesidad identificada, próximo paso definido y resultado con avance. Alta = 4–5 · Media = 2–3 · Baja = 0–1. Si faltan 2 o más campos (necesidad, resultado, feedback), se marca "Sin info suficiente" y no se clasifica.</p>
  ${table([{ h: "Empresa", f: (m) => esc(m.c?.n) }, { h: "Contacto", s: 1, f: (m) => `${esc(m.k?.n ?? "—")}<br>${esc(m.k?.cargo || "sin cargo")}` }, { h: "Fecha", f: (m) => dmy(m.fecha) }, { h: "ICP", f: (m) => yn(m.icpfit) }, { h: "Contacto correcto", f: (m) => yn(m.okct) }, { h: "Necesidad", s: 1, f: (m) => (m.need ? esc(m.need) : '<span class="flag">s/i</span>') }, { h: "Próximo paso", f: (m) => yn(m.next) }, { h: "Feedback cliente", s: 1, f: (m) => (m.fb ? esc(m.fb) : '<span class="flag">s/i</span>') }, { h: "Resultado", f: (m) => esc(m.res) || '<span class="flag">s/i</span>' }, { h: "Calidad", f: (m) => pill(m.q) }],
    M.held.slice().sort((a: any, b: any) => b.fecha.localeCompare(a.fecha)).slice(0, 25))}${M.held.length > 25 ? `<p class="note">Se muestran las 25 más recientes de ${M.held.length}.</p>` : ""}`;

  const fuRow = (x: any) => ({ x, reason: x.sig || x.obj || "" });
  s.seguimientos = `<div class="grid2"><div class="rcard"><h4>Stock de oportunidad</h4><div class="tiles">${tile("Empresas en seguimiento", N(cnt(C, (c) => c.st === "En seguimiento")))}${tile("Empresas por retomar", N(cnt(C, (c) => c.st === "Sin interés ahora - Retomar")))}${tile("Contactos en seguimiento", N(f.K.length), `${cnt(f.K, (x: any) => x.fu === "interes")} con interés activo`)}${tile("Próximos 14 días", N(f.soon.length))}</div></div>
  <div class="rcard"><h4>Trabajo pendiente</h4><div class="tiles">${tile("Seguimientos vencidos", N(f.overdue.length), f.K.length ? P(f.overdue.length / f.K.length) + " del total" : "")}${tile("Sin próxima acción", N(f.none.length), "contactos sin fecha")}${tile("Empresas sin fecha", N(f.coNone.length), "en seguimiento o retomar")}${tile("Empresas vencidas", N(f.coOver.length))}</div></div></div>
  <h4 class="subh">Seguimientos que requieren acción (vencidos y sin fecha)</h4>
  ${table([{ h: "Contacto", f: (r) => esc(r.x.n) }, { h: "Empresa", f: (r) => esc(r.x.c?.n) }, { h: "Cargo", s: 1, f: (r) => esc(r.x.cargo || "—") }, { h: "Motivo", s: 1, f: (r) => esc(r.reason) }, { h: "SDR", s: 1, f: (r) => esc(r.x.sdr) }, { h: "Último contacto", f: (r) => dmy(r.x.last) }, { h: "Próximo seguimiento", f: (r) => (r.x.next ? `<span style="color:var(--bad)">${dmy(r.x.next)}</span>` : '<span class="flag">sin fecha</span>') }, { h: "Próximo paso", s: 1, f: (r) => esc(r.x.ps) }],
    f.overdue.concat(f.none).sort((a: any, b: any) => (a.next || "0").localeCompare(b.next || "0")).slice(0, 30).map(fuRow))}`;

  const refArea = seg(M, (x) => x.area).filter((a) => a.eff >= 5);
  s.referrals = `<div class="tiles">${tile("Referral rate", P(k.referralRate), "refieren a un decisor / contactos efectivos")}${tile("Referrals", N(rf.refs.length))}${tile("Sin contacto referido creado", N(rf.noChild.length), "potencial sin trabajar")}</div>
  <div class="grid2" style="margin-top:14px"><div class="rcard"><h4>Qué generan los referrals</h4>${bars([{ l: "Referrals", v: rf.refs.length }, { l: "Nuevo contacto creado", v: rf.refd.length }, { l: "Conversación con el referido", v: rf.conv.length }, { l: "Seguimiento", v: rf.fu.length }, { l: "Reunión", v: rf.meet.length }, { l: "Referido aún pendiente de gestión", v: rf.pend.length }].map((x, i) => ({ ...x, c: i < 5 ? "var(--g-int)" : "var(--g-pend)" })))}
  <p class="note">Un referral es avance dentro de la cuenta, no un contacto perdido.${rf.refs.length && !rf.refd.length ? " Sin el vínculo \"Referido por\" no se puede trazar qué generó cada referral (Anexo A4)." : ""}</p></div>
  <div class="rcard"><h4>Referral rate por área (áreas con 5+ contactos efectivos)</h4>${bars(refArea.map((a) => ({ l: `${a.key} (n=${a.eff})`, v: div(a.ref, a.eff) || 0, c: "var(--g-act)" })), { pct: 1 })}</div></div>`;

  const ob = K.filter((x) => x.obj), obG = Object.entries(by(ob, (x) => x.obj)).sort((a, b) => b[1].length - a[1].length), op = objectionPattern(M);
  s.objeciones = (ob.length
    ? table([{ h: "Objeción", f: (r) => esc(r[0]) }, { h: "Cantidad", n: 1, f: (r) => r[1].length }, { h: "%", n: 1, f: (r) => P(r[1].length / ob.length) }, { h: "Roles", s: 1, f: (r) => topN(r[1].map((x: any) => x.area)) }, { h: "Industrias", s: 1, f: (r) => topN(r[1].map((x: any) => x.c.ind || "s/i")) }, { h: "País", s: 1, f: (r) => topN(r[1].map((x: any) => x.c.pais)) }, { h: "Tamaño", s: 1, f: (r) => topN(r[1].map((x: any) => x.c.size), null, 1) }], obG)
    : `<p class="note" style="margin-top:0"><b>Sin información disponible:</b> todavía no hay objeciones registradas para este cliente (propiedad "Objeción principal", Anexo A4).</p>`)
    + (ob.length ? `<div class="ins" style="margin-top:14px">${op ? `<div class="in"><span class="ix">→</span><p>${H(`La principal objeción es "${esc(op.obj)}" (${P(op.share)} de ${op.tot} objeciones con motivo).`)}${op.best ? ` ${I(`Aparece especialmente en ${op.best.lab} ${esc(op.best.key)}, donde llega a ${P(op.best.sh)} (n=${op.best.n}).`)}` : ""}</p></div>` : ""}
    <div class="in"><span class="ix">→</span><p>${H(`"No es responsable" (${cnt(ob, (x) => x.obj === "No es responsable")}) viene de contactos No Fit o que refieren; indica calidad de contacto, no rechazo de la propuesta.`)}</p></div></div>` : "")
    + `<p class="note">Fuente: motivo registrado en contactos No Interesado, NO gestionar, Hacer Seguimiento (retomar), Refiere y No Fit.</p>`;

  const sig = Object.entries(by(K.filter((x) => x.sig), (x) => x.sig)).sort((a, b) => b[1].length - a[1].length);
  const posBy = (fn: (x: any) => any) => seg(M, fn).filter((r) => r.eff >= 5).map((r) => ({ l: `${r.key} (n=${r.eff})`, v: r.pos / r.eff, c: "var(--g-int)" }));
  s.senales = `<div class="grid2"><div class="rcard"><h4>Señales de interés registradas (${sum(sig, (x) => x[1].length)})</h4>${sig.length ? bars(sig.map(([l, a]) => ({ l, v: a.length, c: "var(--g-int)" }))) : '<p class="note" style="margin-top:0">Sin información disponible (propiedad "Señal de interés", Anexo A4).</p>'}</div>
  <div class="rcard"><h4>% de conversaciones con señal positiva, por seniority</h4>${bars(posBy((x) => x.sen), { pct: 1, max: 1 })}<h4 style="margin-top:14px">Por tamaño de empresa</h4>${bars(posBy((x) => x.c.size), { pct: 1, max: 1 })}</div></div>
  <div class="rcard" style="margin-top:14px"><h4>Por industria</h4>${bars(posBy((x) => x.c.ind || "Sin industria"), { pct: 1, max: 1 })}<p class="note">Señal positiva = reunión, seguimiento o referral. Segmentos con menos de 5 conversaciones se omiten.</p></div>`;

  const discard: [string, string][] = [["No interesados", "Rechazo del decisor"], ["No califica", "Fuera de ICP (decisión del SDR)"], ["Gestionada - sin contactos fit", "No hay interlocutores ICP"], ["Sin contactos - (ya nutrida)", "Nutrida sin contactos nuevos"], ["Gestionada - sin comunicación", "No se logró hablar con nadie"], ["Clientes", "Ya es cliente del cliente"]];
  const recovTxt: Record<string, string> = { "No interesados": "Revisar en 6–12 meses si cambia contexto", "No califica": "No, salvo cambio de ICP", "Gestionada - sin contactos fit": "Sí, con nueva búsqueda de contactos", "Sin contactos - (ya nutrida)": "Sí, con otra fuente de datos", "Gestionada - sin comunicación": "Sí, con otro canal o nutrición", "Clientes": "Oportunidad de upsell para el cliente" };
  const rejObj = Object.entries(by(C.filter((c) => c.st === "No interesados").flatMap((c) => c.K.filter((x: any) => REJ.has(x.st) && x.obj)), (x: any) => x.obj)).sort((a, b) => b[1].length - a[1].length);
  s.descartadas = table([{ h: "Motivo de salida", f: (r) => esc(r[0]) }, { h: "Qué significa", s: 1, f: (r) => r[1] }, { h: "Empresas", n: 1, f: (r) => cnt(C, (c) => c.st === r[0]) }, { h: "% trabajadas", n: 1, f: (r) => P(cnt(C, (c) => c.st === r[0]) / Math.max(1, k.worked)) }, { h: "¿Recuperable?", s: 1, f: (r) => recovTxt[r[0]] }], discard)
    + `<div class="rcard" style="margin-top:14px"><h4>Motivo del rechazo en empresas "No interesados"</h4>${rejObj.length ? bars(rejObj.map(([l, a]) => ({ l, v: a.length, c: "var(--g-rej)" }))) : '<p class="note" style="margin-top:0">Sin información disponible.</p>'}</div>`;

  const icpS = segCo(M, (c) => "ICP " + c.icp).sort((a, b) => a.key.localeCompare(b.key));
  const icpBad = cnt(M.worked, (c: any) => c.st === "No califica"), noFit = cnt(M.mg, (x: any) => x.st === "Contacto No Fit para gestión");
  const hasTier = C.some((c) => ["A", "B", "C"].includes(c.icp));
  s.icp = `<div class="tiles">${tile("Empresas fuera de ICP", P(div(icpBad, k.worked)), `${icpBad} marcadas "No califica"`)}${tile("Contactos no fit", P(div(noFit, M.mg.length)), "persona equivocada dentro de la empresa")}${tile("Empresas sin contactos ICP", N(cnt(C, (c) => c.st === "Gestionada - sin contactos fit" || c.st === "Sin contactos - (ya nutrida)")))}</div>
  <div style="margin-top:14px">${table([{ h: "Segmento ICP", f: (r) => esc(r.key) }, { h: "Empresas", n: 1, f: (r) => r.co }, { h: "Cobertura", n: 1, f: (r) => P(r.cov) }, { h: "Contacto efectivo", n: 1, f: (r) => P(r.cr) }, { h: "Con reunión", n: 1, f: (r) => r.coMt }, { h: "Reunión / trabajada", n: 1, f: (r) => P(r.mRate) + small(r) }, { h: "Oportunidades", n: 1, f: (r) => r.opp }], icpS)}</div>
  <p class="note">${M.source === "demo" ? "El tier ICP (A/B/C) es una propiedad propuesta: hoy no existe en HubSpot y en los datos demo está simulada." : hasTier ? "Tier ICP leído de HubSpot." : "El tier ICP (A/B/C) todavía no está registrado en HubSpot (Anexo A4): solo se puede medir \"No califica\" de forma binaria."}</p>`;

  const roleCols: Col[] = [{ h: "Segmento", f: (r) => esc(r.key) + small(r) }, { h: "Contactos", n: 1, f: (r) => r.n }, { h: "Gestionados", n: 1, f: (r) => r.mg }, { h: "Efectivos", n: 1, f: (r) => r.eff }, { h: "Contacto→conv.", n: 1, f: (r) => P(r.cr) }, { h: "Conv.→reunión", n: 1, f: (r) => P(r.c2m) }, { h: "Contacto→reunión", n: 1, f: (r) => P(r.k2m) }, { h: "Reuniones", n: 1, f: (r) => r.meet }, { h: "Seguim.", n: 1, f: (r) => r.fu }, { h: "Rechazo", n: 1, f: (r) => P(div(r.rej, r.eff)) }, { h: "Referral", n: 1, f: (r) => P(div(r.ref, r.eff)) }, { h: "Sin contacto", n: 1, f: (r) => P(div(r.nr, r.mg)) }];
  const areasR = seg(M, (x) => x.area), okA = areasR.filter((a) => !a.small), mx = (arr: any[], fn: (a: any) => number) => arr.slice().sort((a, b) => fn(b) - fn(a))[0];
  s.rol = `<h4 class="subh" style="margin-top:0">Por área</h4>${table(roleCols, areasR, { dim: (r) => r.small })}
  <h4 class="subh">Por seniority</h4>${table(roleCols, seg(M, (x) => x.sen), { dim: (r) => r.small })}
  ${okA.length >= 2 ? `<div class="tiles" style="margin-top:14px">${tile("Responde más", esc(mx(okA, (a) => a.cr).key), P(mx(okA, (a) => a.cr).cr) + " contacto efectivo")}${tile("Más reuniones", esc(mx(okA, (a) => a.c2m).key), P(mx(okA, (a) => a.c2m).c2m) + " conv.→reunión")}${tile("Más seguimiento", esc(mx(okA, (a) => a.fu / a.eff).key), P(mx(okA, (a) => a.fu / a.eff).fu / mx(okA, (a) => a.fu / a.eff).eff))}${tile("Rechaza más", esc(mx(okA, (a) => a.rej / a.eff).key), P(mx(okA, (a) => a.rej / a.eff).rej / mx(okA, (a) => a.rej / a.eff).eff))}${tile("Menor contactabilidad", esc(mx(okA, (a) => a.nr / a.mg).key), P(mx(okA, (a) => a.nr / a.mg).nr / mx(okA, (a) => a.nr / a.mg).mg) + " sin contacto")}${tile("Más referrals", esc(mx(okA, (a) => a.ref / a.eff).key), P(mx(okA, (a) => a.ref / a.eff).ref / mx(okA, (a) => a.ref / a.eff).eff))}</div>` : ""}
  <p class="note">Filas en gris: menos de ${MIN_N} contactos efectivos; se muestran pero no se usan para concluir. Los destacados solo consideran segmentos con muestra suficiente.</p>`;

  const indR = segCo(M, (c) => c.ind || "Sin industria"), okI = indR.filter((r) => !r.small && r.key !== "Sin industria");
  const coCols = (lab: string): Col[] => [{ h: lab, f: (r) => esc(r.key) + small(r) }, { h: "Empresas", n: 1, f: (r) => r.co }, { h: "Trabajadas", n: 1, f: (r) => r.worked }, { h: "Contactos", n: 1, f: (r) => r.ct }, { h: "Actividades", n: 1, f: (r) => N(r.acts) }, { h: "Conversaciones", n: 1, f: (r) => r.eff }, { h: "Reuniones", n: 1, f: (r) => r.mt }, { h: "Realizadas", n: 1, f: (r) => r.held }, { h: "Realización", n: 1, f: (r) => P(r.real) }, { h: "Reunión / trabajada", n: 1, f: (r) => P(r.mRate) }, { h: "Seguim.", n: 1, f: (r) => r.fu }, { h: "Oport.", n: 1, f: (r) => r.opp }];
  let indHi = "";
  if (okI.length >= 2) {
    const best = mx(okI, (r) => r.mRate), worst = okI.slice().sort((a, b) => a.mRate - b.mRate)[0], under = indR.filter((r) => r.co >= 5).sort((a, b) => a.cov - b.cov)[0];
    const posRate = (r: any) => (r.conv ? cnt(C.filter((c) => (c.ind || "Sin industria") === r.key), (c) => c.pos) / r.conv : 0);
    const pot = okI.filter((r) => r !== best).sort((a, b) => posRate(b) - posRate(a))[0];
    const obI = Object.entries(by(K.filter((x) => x.obj && x.obj !== "No es responsable"), (x) => x.c.ind || "s/i")).filter(([, a]) => a.length >= 6).map(([ind, a]) => { const t = Object.entries(by(a, (x: any) => x.obj)).sort((p, q) => q[1].length - p[1].length)[0]; return [ind, t[0], t[1].length / a.length, a.length] as [string, string, number, number]; }).sort((a, b) => b[2] - a[2])[0];
    indHi = `<div class="tiles" style="margin-top:14px">${tile("Mejor industria", esc(best.key), `${P(best.mRate)} reunión por empresa trabajada`)}${tile("Peor industria", esc(worst.key), `${P(worst.mRate)} reunión por empresa trabajada`)}${pot ? tile("Con potencial", esc(pot.key), "alta proporción de interés sobre conversaciones") : ""}${under ? tile("Subtrabajada", esc(under.key), `cobertura ${P(under.cov)}`) : ""}${obI ? tile("Objeción específica", esc(obI[0]), `${esc(obI[1])}: ${P(obI[2])} (n=${obI[3]})`) : ""}</div>`;
  }
  s.industria = table(coCols("Industria"), indR, { dim: (r) => r.small }) + indHi + `<p class="note">Filas en gris: menos de 8 empresas trabajadas. Unidad de reuniones: reuniones (no empresas).</p>`;

  const paisR = segCo(M, (c) => c.pais);
  s.pais = paisR.length < 2 ? `<p class="note" style="margin-top:0">Este cliente opera en un solo mercado (${esc(paisR[0]?.key ?? "—")}); no aplica comparación por país.</p>` : table(coCols("País"), paisR, { dim: (r) => r.small }) + `<p class="note">No se asume que todos los mercados se comporten igual: comparar tasas, no volúmenes.</p>`;

  const sdrR = cl.sdrs.map((sd: string) => {
    const Cs = C.filter((c) => c.sdr === sd), Ks = K.filter((x) => x.sdr === sd), Ms = M.Mt.filter((m: any) => m.sdr === sd), eff = Ks.filter((x) => x.eff), ce = Cs.filter((c) => c.effK.length);
    const hq = M.held.filter((m: any) => m.sdr === sd && m.q !== "na");
    return {
      sd, co: cnt(Cs, (c) => c.worked), mg: cnt(Ks, (x) => x.mg), eff: eff.length, cr: div(eff.length, cnt(Ks, (x) => x.mg)), mt: Ms.length, held: cnt(Ms, (m: any) => m.st === "Realizada"), fu: cnt(Ks, (x) => x.st === "Hacer Seguimiento"), ref: cnt(Ks, (x) => x.st === "Refiere con el Tomador de Decisiones"),
      c2m: div(cnt(Ks, (x) => x.st === "Reunión Agendada"), eff.length), multi: div(cnt(ce, (c) => c.effK.length >= 2), ce.length), q: hq.length >= 3 ? div(cnt(hq, (m: any) => m.q !== "lo"), hq.length) : null, calls: sum(Ks, (x) => x.calls || 0),
      hot: cnt(Ks, (x) => x.st === "Hot Calling 🔥"), over: cnt(f.overdue, (x: any) => x.sdr === sd), none: cnt(f.none, (x: any) => x.sdr === sd), idle: cnt(Cs, (c) => c.st === "Asignada" && c.asg < d30), multiPend: cnt(Cs, (c) => cnt(c.K, (x: any) => PEND.has(x.st)) >= 3),
      base: cnt(Ks, (x) => x.st === "Sin Información de Contacto" || x.st === "Contacto No Fit para gestión"),
    };
  });
  s.sdr = table([{ h: "SDR", f: (r) => esc(r.sd) }, { h: "Empresas gestionadas", n: 1, f: (r) => r.co }, { h: "Contactos gestionados", n: 1, f: (r) => r.mg }, { h: "Efectivos", n: 1, f: (r) => r.eff }, { h: "Contacto efectivo", n: 1, f: (r) => P(r.cr) }, { h: "Reuniones", n: 1, f: (r) => r.mt }, { h: "Realizadas", n: 1, f: (r) => r.held }, { h: "Seguim.", n: 1, f: (r) => r.fu }, { h: "Referrals", n: 1, f: (r) => r.ref }, { h: "Conv.→reunión", n: 1, f: (r) => P(r.c2m) }, { h: "Multi-thread", n: 1, f: (r) => P(r.multi) }, { h: "Calidad Alta/Media", n: 1, f: (r) => (r.q == null ? '<span class="flag">s/i</span>' : P(r.q)) }], sdrR)
    + `<h4 class="subh">Disciplina operativa (lo que sí depende del SDR)</h4>`
    + table([{ h: "SDR", f: (r) => esc(r.sd) }, { h: "Hot Calling pendientes", n: 1, f: (r) => r.hot }, { h: "Seguim. vencidos", n: 1, f: (r) => r.over }, { h: "Conversaciones sin próxima acción", n: 1, f: (r) => r.none }, { h: "Empresas asignadas +30 días sin gestión", n: 1, f: (r) => r.idle }, { h: "Cuentas con 3+ contactos pendientes", n: 1, f: (r) => r.multiPend }, { h: "Llamadas (actividad)", n: 1, f: (r) => `<span style="color:var(--muted)">${N(r.calls)}</span>` }, { h: "Contactos con problema de base", n: 1, f: (r) => `<span style="color:var(--muted)">${r.base}</span>` }], sdrR)
    + `<p class="note">Las llamadas son actividad operativa, no indicador de éxito. "Problema de base" (sin teléfono o contacto no fit) se muestra como contexto y no penaliza al SDR.${cl.sdrs.length === 1 ? " Un solo SDR asignado: no hay comparación interna." : ""}</p>`;

  const half = Math.floor(M.MONTHS.length / 2);
  const trendLab = half ? `${M.MLAB[M.MONTHS[M.MONTHS.length - half]].replace("*", "")}–${M.MLAB[M.MONTHS[M.MONTHS.length - 1]].replace("*", "")} vs ${M.MLAB[M.MONTHS[M.MONTHS.length - 2 * half]]}–${M.MLAB[M.MONTHS[M.MONTHS.length - half - 1]]}` : "";
  const actEvo = M.ad.dated ? `<div class="rcard" style="margin-top:16px"><h4>Actividades ${perUnit(M)} y canal</h4>${lineChart(CHANNELS.filter((x) => M.ad.tot[x.k]).map((x) => ({ n: x.l, c: x.c, v: M.ad.months.map((m: any) => m[x.k]) })), monthLabels(M))}<p class="note">Actividades asociadas a las empresas del universo o a sus contactos, por fecha de la actividad.</p></div>` : "";
  s.evolucion = `<div class="grid2"><div class="rcard"><h4>Reuniones ${perUnit(M)}</h4>${lineChart([{ n: "Agendadas", c: "var(--s1)", v: M.month.map((m: any) => m.sch) }, { n: "Realizadas", c: "var(--s2)", v: M.month.map((m: any) => m.held) }], monthLabels(M))}</div>
  <div class="rcard"><h4>Actividad de cuentas ${perUnit(M)}</h4>${lineChart([{ n: "Empresas asignadas", c: "var(--s1)", v: M.month.map((m: any) => m.asg) }, { n: "Contactos efectivos (por última actividad)", c: "var(--s2)", v: M.month.map((m: any) => m.eff) }], monthLabels(M))}</div></div>
  <p class="note">${partialNote(M)}Tendencia de reuniones (${trendLab}, normalizado): ${h.ratio == null ? "sin datos" : (h.ratio >= 1 ? "+" : "") + P(h.ratio - 1)}. Los contactos efectivos usan la fecha de última actividad como aproximación; con el historial de cambios de estado de HubSpot se podrá fechar cada transición.</p>${actEvo}`;

  s["stock-op"] = `<div class="tiles">${tile("Empresas asignadas sin gestión", N(cnt(C, (c) => c.st === "Asignada")), `${cnt(C, (c) => c.st === "Asignada" && c.asg < d30)} con más de 30 días`)}${tile("Hot Calling 🔥", N(cnt(K, (x) => x.st === "Hot Calling 🔥")), "gestión inmediata")}${tile("Por gestionar", N(cnt(K, (x) => x.st === "Por gestionar")))}${tile("Buscar", N(cnt(K, (x) => x.st === "Buscar")), "búsqueda de teléfono")}${tile("Seguimientos vencidos", N(f.overdue.length))}${tile("Contactos pendientes", N(cnt(K, (x) => PEND.has(x.st))), "total Hot + Por gestionar + Buscar")}</div>
  <p class="note">Responde a: ¿cuánto trabajo pendiente existe? Incluye ${N(cnt(K, (x) => x.nuevo))} contactos nuevos agregados en empresas ya nutridas.</p>`;

  const multiLive = C.filter((c) => c.effK.length >= 2 && ["En seguimiento", "Reunión Agendada", "Sin interés ahora - Retomar"].includes(c.st));
  s["stock-opp"] = `<div class="tiles">${tile("Empresas en seguimiento", N(cnt(C, (c) => c.st === "En seguimiento")))}${tile("Contactos con interés activo", N(cnt(K, (x) => x.fu === "interes")))}${tile("Referrals por trabajar", N(rf.noChild.length + rf.pend.length))}${tile("Reuniones pendientes", N(M.pendM.length))}${tile("Empresas multi-thread activas", N(multiLive.length))}${tile("Proyectos futuros", N(cnt(K, (x) => x.sig === "Indica proyecto futuro")), "contactos que anticipan proyecto")}${tile("Conversaciones activas", N(cnt(K, (x) => x.sig === "Conversación activa")), "WhatsApp abierto")}</div>
  <p class="note">Responde a: ¿cuánto potencial comercial está vivo hoy? Se separa del stock operativo para no mezclar oportunidad con carga de trabajo.</p>`;

  const recReason: Record<string, [string, string]> = { "Sin interés ahora - Retomar": ["Pidió retomar: demanda con fecha", "Retomar en la fecha acordada con contenido nuevo"], "Nutrir": ["Nadie contestó: problema de canal, no de interés", "Nutrir y reasignar con nuevos contactos"], "Empresa ya nutrida": ["Tiene contactos nuevos listos", "Tomar como asignación nueva"], "Sin contactos - (ya nutrida)": ["Falta dato, no interés", "Buscar con otra fuente (LinkedIn Sales Nav, referidos)"], "Gestionada por LinkedIn": ["Canal alternativo en curso", "Seguir cadencia LinkedIn y volver a teléfono si responde"], "Gestionada - sin comunicación": ["Se agotaron intentos sin respuesta", "Reintentar en 90 días por otro canal"] };
  const recov = C.filter((c) => recReason[c.st]);
  s.recuperables = `<div class="tiles">${Object.keys(recReason).map((st) => tile(esc(st), N(cnt(C, (c) => c.st === st)))).join("")}</div>
  <div style="margin-top:14px">${table([{ h: "Empresa", f: (c) => esc(c.n) }, { h: "Estado", s: 1, f: (c) => esc(c.st) }, { h: "Industria", s: 1, f: (c) => esc(c.ind || "—") }, { h: "ICP", f: (c) => esc(c.icp) }, { h: "Contactos", n: 1, f: (c) => c.nct || 0 }, { h: "Por qué puede volver", s: 1, f: (c) => recReason[c.st][0] }, { h: "Acción sugerida", s: 1, f: (c) => recReason[c.st][1] + (c.next ? ` (${dmy(c.next)})` : "") }], recov.sort((a, b) => String(a.icp).localeCompare(String(b.icp))).slice(0, 30))}</div>
  <p class="note">${recov.length} cuentas recuperables en total; se muestran 30, ordenadas por ICP. Ninguna debe contarse como pérdida definitiva.</p>`;

  const ins = insights(M);
  s.inteligencia = ins.length ? `<div class="ins">${ins.map((x, i) => `<div class="in" style="--c:var(--accent)"><span class="ix">${String(i + 1).padStart(2, "0")}</span><p>${esc(x.t)}</p><div class="ev"><b>Dato:</b> ${esc(x.ev)}<br><b>Interpretación:</b> ${esc(x.i)}</div></div>`).join("")}</div>` : `<p class="note">No hay volumen suficiente para generar patrones confiables en este cliente.</p>`;
  const lr = learnings(M);
  s.aprendizajes = lr.length ? `<div class="ins">${lr.map((x, i) => `<div class="in" style="--c:var(--teal)"><span class="ix">${String(i + 1).padStart(2, "0")}</span><p><span class="tag" style="margin-right:8px">${x[0]}</span>${esc(x[1])}</p><div class="ev">${esc(x[2])}</div></div>`).join("")}</div>` : `<p class="note">Todavía no hay muestra suficiente para extraer aprendizajes del mercado.</p>`;

  const prioRank: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };
  const opps = C.filter((c) => c.prio).sort((a, b) => prioRank[a.prio] - prioRank[b.prio]);
  s.oportunidades = `<div class="tiles">${["Alta", "Media", "Baja"].map((p) => tile(prioPill(p), N(cnt(opps, (c) => c.prio === p)), "empresas")).join("")}</div>
  <div style="margin-top:14px">${table([{ h: "Prioridad", f: (c) => prioPill(c.prio) }, { h: "Empresa", f: (c) => esc(c.n) }, { h: "Estado", s: 1, f: (c) => esc(c.st) }, { h: "ICP", f: (c) => esc(c.icp) }, { h: "Interlocutores", s: 1, f: (c) => c.effK.map((x: any) => esc(x.cargo || x.area)).join(", ") || "—" }, { h: "Por qué", s: 1, f: (c) => esc(c.why) }, { h: "Siguiente acción", s: 1, f: (c) => esc((c.K.find((x: any) => x.st === "Reunión Agendada" || x.st === "Hacer Seguimiento" || x.st === "Refiere con el Tomador de Decisiones") || c.K[0] || {}).ps || "—") }], opps.slice(0, 30))}</div>
  <p class="note">Puntaje: reunión realizada con avance +3, reunión próxima +2, interés activo +2, referral sin trabajar +2, referido pendiente +1, proyecto futuro +1, varios interlocutores +1, ICP A +1. Alta ≥ 4 · Media 2–3 · Baja 1.</p>`;

  const recList = (R: [string, string, string][], c: string) => (R.length ? `<div class="ins">${R.map((x, i) => `<div class="in" style="--c:${c}"><span class="ix">${String(i + 1).padStart(2, "0")}</span><p><span class="tag" style="margin-right:8px">${x[0]}</span>${esc(x[1])}</p><div class="ev"><b>Evidencia:</b> ${esc(x[2])}</div></div>`).join("")}</div>` : `<p class="note">Sin recomendaciones gatilladas por los datos actuales.</p>`);
  s["rec-be"] = recList(recsBE(M), "var(--magenta)");
  s["rec-cli"] = recList(recsCli(M), "var(--g-act)");

  Object.assign(s, annex(M, mapping));
  return s;
}

/* ---------- tablas maestras (filas + columnas, el filtro/exportación va en React) ---------- */
export function masterCompanyCols(M: Model): (Col & { x: (r: any) => any })[] {
  const cl = M.cl;
  const hasWl = (M.C as any[]).some((c) => c.wl);
  const cols: (Col & { x: (r: any) => any })[] = [
    { h: "Empresa", f: (c) => esc(c.n), x: (c) => c.n },
    { h: "Cliente", s: 1, f: () => esc(cl.name), x: () => cl.name },
    { h: "País", s: 1, f: (c) => esc(c.pais), x: (c) => c.pais },
    { h: "Industria", s: 1, f: (c) => esc(c.ind || "—"), x: (c) => c.ind || "" },
    { h: "ICP", f: (c) => esc(c.icp), x: (c) => c.icp },
    { h: "SDR", s: 1, f: (c) => esc(c.sdr), x: (c) => c.sdr },
    { h: "Status Empresa", s: 1, f: (c) => esc(c.st), x: (c) => c.st },
    { h: "Contactos", n: 1, f: (c) => c.nct || 0, x: (c) => c.nct || 0 },
    { h: "Gestionados", n: 1, f: (c) => c.nmg || 0, x: (c) => c.nmg || 0 },
    { h: "Efectivos", n: 1, f: (c) => c.neff || 0, x: (c) => c.neff || 0 },
    { h: "Roles", s: 1, f: (c) => esc((c.areas || []).join(", ")), x: (c) => (c.areas || []).join(", ") },
    { h: "Actividades", n: 1, f: (c) => N(c.acts || 0), x: (c) => c.acts || 0 },
    { h: "Canales", s: 1, f: (c) => esc(CHANNELS.filter((x) => c.ch?.[x.k]).map((x) => x.l).join(", ") || "—"), x: (c) => CHANNELS.filter((x) => c.ch?.[x.k]).map((x) => x.l).join(", ") },
    { h: "R. agendadas", n: 1, f: (c) => c.msch || 0, x: (c) => c.msch || 0 },
    { h: "R. realizadas", n: 1, f: (c) => c.mheld || 0, x: (c) => c.mheld || 0 },
    { h: "Seguimiento", f: (c) => (c.fu ? "Sí" : "No"), x: (c) => (c.fu ? "Sí" : "No") },
    { h: "Oportunidad", f: (c) => (c.opp ? "Sí" : "No"), x: (c) => (c.opp ? "Sí" : "No") },
    { h: "Profundidad", s: 1, f: (c) => esc(c.depth), x: (c) => c.depth },
    { h: "Prioridad", f: (c) => prioPill(c.prio), x: (c) => c.prio },
  ];
  // Wishlist del cliente, solo si la propiedad trae valores
  if (hasWl) cols.splice(4, 0, { h: "Wishlist", s: 1, f: (c) => esc(c.wl || "—"), x: (c) => c.wl || "" });
  return cols;
}
export function masterContactCols(M: Model): (Col & { x: (r: any) => any })[] {
  const mByCt = new Map((M.Mt as any[]).map((m) => [m.ct, m]));
  const acts = (x: any) => (x.calls || 0) + (x.wa || 0) + (x.li || 0) + (x.em || 0);
  const refTxt = (x: any) => (x.st === "Refiere con el Tomador de Decisiones" ? "Refiere" : x.refBy ? "Referido" : "—");
  return [
    { h: "Contacto", f: (x) => esc(x.n), x: (x) => x.n },
    { h: "Empresa", s: 1, f: (x) => esc(x.c?.n), x: (x) => x.c?.n ?? "" },
    { h: "Cargo", s: 1, f: (x) => esc(x.cargo || "—"), x: (x) => x.cargo || "" },
    { h: "Área", s: 1, f: (x) => esc(x.area), x: (x) => x.area },
    { h: "País", s: 1, f: (x) => esc(x.c?.pais), x: (x) => x.c?.pais ?? "" },
    { h: "SDR", s: 1, f: (x) => esc(x.sdr), x: (x) => x.sdr },
    { h: "Status Contacto", s: 1, f: (x) => esc(x.st), x: (x) => x.st },
    { h: "Actividades", n: 1, f: acts, x: acts },
    { h: "Intentos", n: 1, f: (x) => x.att || 0, x: (x) => x.att || 0 },
    { h: "Contactado", f: (x) => (x.eff ? "Sí" : "No"), x: (x) => (x.eff ? "Sí" : "No") },
    { h: "Interés", s: 1, f: (x) => esc(x.sig || "—"), x: (x) => x.sig || "" },
    { h: "Seguimiento", f: (x) => (x.st === "Hacer Seguimiento" ? "Sí" : "No"), x: (x) => (x.st === "Hacer Seguimiento" ? "Sí" : "No") },
    { h: "Reunión", s: 1, f: (x) => esc(mByCt.get(x.id)?.st ?? "—"), x: (x) => mByCt.get(x.id)?.st ?? "" },
    { h: "Referral", s: 1, f: refTxt, x: refTxt },
    { h: "Próximo paso", s: 1, f: (x) => esc(x.ps), x: (x) => x.ps },
  ];
}
export const companyStatusLabel = (key: string, clientName: string) => (key === "CONV" ? `En conversaciones con ${clientName}` : key);

/* ---------- anexo: validación de datos ---------- */
export function annex(M: Model, mapping?: { label: string; property: string | null }[] | null) {
  const C: any[] = M.C, K: any[] = M.K, s: Record<string, string> = {};
  const props: [string, string, string, string, string][] = [
    ["Empresa", "Status de la asignación - SDR", "propiedad personalizada (enumeración)", "Estado de gestión de la cuenta", "ok"],
    ["Empresa", "Cliente BullsEye", "propiedad personalizada o lista por cliente", "Separar universos por cliente", "req"],
    ["Empresa", "Nombre, Industria, País", "name · industry · country", "Segmentación", "ok"],
    ["Empresa", "Tamaño", "numberofemployees / annualrevenue", "Pyme / Mid-market / Enterprise (tramos en Configuración)", "ok"],
    ["Empresa", "SDR asignado", "hubspot_owner_id o propiedad SDR", "Análisis por SDR", "ok"],
    ["Empresa", "Fecha de asignación", "propiedad personalizada o historial de la propiedad de status", "Cobertura en el tiempo, empresas sin gestión", "req"],
    ["Empresa", "Tier ICP", "no existe (propuesta)", "Análisis ICP", "new"],
    ["Contacto", "Asignación BullsEye por Llamar", "propiedad personalizada (enumeración)", "Estado de gestión del contacto", "ok"],
    ["Contacto", "Cargo", "jobtitle", "Análisis por rol", "ok"],
    ["Contacto", "Área y seniority", "no existe: derivar de jobtitle o crear propiedades", "Análisis por rol comparable", "new"],
    ["Contacto", "Última actividad / próxima actividad", "notes_last_contacted · notes_next_activity_date", "Seguimientos vencidos y próximos", "ok"],
    ["Contacto", "Referido por", "no existe (propuesta: etiqueta de asociación contacto–contacto)", "Trazar qué genera cada referral", "new"],
    ["Contacto", "Objeción / señal de interés", "hoy en texto libre de notas", "Objeciones y señales sin depender de lectura manual", "new"],
    ["Actividad", "Llamadas", "objeto Calls: hs_call_disposition · hs_call_duration · hs_timestamp", "Intentos, conversación real (disposición Conectado)", "ok"],
    ["Actividad", "WhatsApp / LinkedIn", "objeto Communications (canal) o notas", "Mix de canales", "req"],
    ["Actividad", "Notas y tareas", "hs_note_body · tareas con fecha", "Objeciones, próximo paso", "ok"],
    ["Reunión", "Reunión", "objeto Meetings: hs_meeting_start_time · hs_meeting_outcome", "Agendada / realizada / no-show / cancelada / reprogramada", "ok"],
    ["Reunión", "Resultado y feedback de la reunión", "no existe (propuesta)", "Calidad y oportunidad", "new"],
    ["Negocio", "Oportunidad / pipeline", "objeto Deals: pipeline · dealstage · amount · createdate", "Oportunidades y pipeline (solo si el cliente lo registra)", "req"],
  ];
  const stt: Record<string, string> = { ok: '<span class="pill hi">Disponible</span>', req: '<span class="pill md">Requiere configuración</span>', new: '<span class="pill lo">No existe: crear</span>' };
  s["datos-prop"] = `<p class="note" style="margin-top:0">Mapeo esperado a partir de la estructura estándar de HubSpot más las dos propiedades clave. Los nombres internos de las propiedades personalizadas se confirman en Configuración del Radar ABM.</p>`
    + table([{ h: "Objeto", f: (r) => r[0] }, { h: "Dato", f: (r) => esc(r[1]) }, { h: "Propiedad HubSpot", s: 1, f: (r) => `<code>${esc(r[2])}</code>` }, { h: "Uso en el informe", s: 1, f: (r) => esc(r[3]) }, { h: "Estado", f: (r) => stt[r[4]] }], props)
    + (mapping && mapping.length
      ? `<h4 class="subh">Nombres internos usados en la última sincronización</h4>` + table([{ h: "Dato", f: (r) => esc(r.label) }, { h: "Nombre interno", s: 1, f: (r) => (r.property ? `<code>${esc(r.property)}</code>` : '<span class="flag">no encontrada: se muestra "Sin información disponible"</span>') }], mapping)
      : "");
  s["datos-metr"] = `<div class="grid2"><div class="rcard"><h4>Se calculan directamente</h4><ul class="clean"><li>Cobertura, estados de empresa y contacto, destino de cuentas</li><li>Contactabilidad, referral rate, multi-threading y profundidad</li><li>Reuniones agendadas, realizadas, no-show, canceladas y reprogramadas (hs_meeting_outcome)</li><li>Seguimientos vencidos y próximos (fecha de próxima actividad)</li><li>Stock operativo y de oportunidad</li><li>Análisis por industria, país, cargo y SDR</li></ul></div>
  <div class="rcard"><h4>Requieren información adicional</h4><ul class="clean"><li><b>Área y seniority</b>: normalizar cargos (tabla de equivalencias o propiedad)</li><li><b>Objeciones y señales</b>: hoy en texto libre; se pueden clasificar leyendo notas, con revisión humana</li><li><b>Calidad de reunión</b>: necesita resultado y feedback post reunión</li><li><b>Oportunidad y pipeline</b>: solo en clientes que registran negocios en HubSpot</li><li><b>Referrals → resultado</b>: necesita vínculo "referido por"</li><li><b>Tier ICP</b>: no existe como propiedad</li><li><b>Conversación real vs. llamada</b>: depende de usar la disposición de llamada</li><li><b>Evolución por etapa</b>: requiere historial de cambios de estado</li></ul></div></div>`;
  const inc: [string, number, string][] = [
    ["Empresas \"Asignada\" con actividad registrada", cnt(C, (c) => c.st === "Asignada" && c.K.some((x: any) => x.att)), "El status de empresa no se actualizó al comenzar la gestión."],
    ["Contactos \"No Contestó\" con menos de 10 intentos", cnt(K, (x) => x.st === "No Contestó" && (x.att || 0) < 10), "Se cerró antes de completar la cadencia definida."],
    ["Contactos \"Hacer Seguimiento\" sin fecha de próxima acción", cnt(K, (x) => x.st === "Hacer Seguimiento" && !x.next), "El seguimiento queda sin responsable ni fecha."],
    ["Empresas en seguimiento o retomar sin fecha", cnt(C, (c) => (c.st === "En seguimiento" || c.st === "Sin interés ahora - Retomar") && !c.next), "No se puede medir vencimiento."],
    ["Empresas \"Reunión Agendada\" cuyas reuniones fueron canceladas o no-show", cnt(C, (c) => c.st === "Reunión Agendada" && c.M.length && c.M.every((m: any) => m.st === "Cancelada" || m.st === "No-show")), "Status no refleja la situación real; revisar reagendamiento."],
    ["Referrals sin contacto referido creado", M.ref.noChild.length, "No se puede medir qué generó el referral."],
    ["Reuniones realizadas sin resultado", cnt(M.held, (m: any) => !m.res), "Impide medir oportunidad."],
    ["Reuniones realizadas sin feedback del cliente", cnt(M.held, (m: any) => !m.fb), "Impide medir calidad."],
    ["Contactos sin cargo", cnt(K, (x) => !x.cargo), "Quedan fuera del análisis por rol."],
    ["Empresas sin industria", cnt(C, (c) => !c.ind), "Quedan fuera del análisis por industria."],
    [`Contactos en "${PAUSA}"`, cnt(K, (x) => x.st === PAUSA), "Estado sin grupo analítico oficial; se propone tratarlo como pausa neutral."],
  ];
  s["datos-inc"] = table([{ h: "Chequeo", f: (r) => esc(r[0]) }, { h: "Casos", n: 1, f: (r) => (r[1] ? `<b style="color:${r[1] > 5 ? "var(--bad)" : "var(--warn)"}">${r[1]}</b>` : '<span style="color:var(--good)">0</span>') }, { h: "Impacto", s: 1, f: (r) => esc(r[2]) }], inc)
    + `<p class="note">Otras definiciones a validar con el equipo: (1) "En conversaciones con [cliente]" figura en dos grupos (interés y relación existente); (2) "Nutrir" es a la vez problema de contactabilidad y reciclaje; (3) cuál es el universo "objetivo" de cada cliente (lista, propiedad o todas las empresas asociadas); (4) si "Contacto No Fit" debe contarse como conversación.</p>`;
  const nw: [string, string, string, string][] = [["Objeción principal", "Contacto", "Enumeración con las 10 categorías del informe", "Objeciones sin lectura manual de notas"], ["Señal de interés", "Contacto", "Enumeración (solicita info, propuesta, demo, proyecto futuro…)", "Señales de interés y priorización"], ["Referido por", "Contacto", "Etiqueta de asociación contacto → contacto", "Resultado de cada referral"], ["Tier ICP", "Empresa", "A / B / C acordado con el cliente", "Análisis ICP y priorización"], ["Área y seniority", "Contacto", "Enumeraciones normalizadas", "Análisis por rol comparable entre clientes"], ["Fecha de próximo seguimiento obligatoria", "Contacto / empresa", "Requerida al pasar a Hacer Seguimiento o En seguimiento", "Seguimientos vencidos confiables"], ["Resultado de la reunión", "Reunión", "Oportunidad / Seguimiento / Descartada / Sin avance", "Calidad y conversión a oportunidad"], ["Feedback del cliente", "Reunión", "Texto + calificación 1–5", "Calidad de reunión"], ["Canal del contacto efectivo", "Contacto", "Teléfono / WhatsApp / LinkedIn / Email", "Qué canal convierte"], ["Motivo de descarte", "Empresa", "Enumeración", "Empresas descartadas y recuperables"], ["Origen BullsEye en negocios", "Negocio", "Casilla o fuente del negocio", "Pipeline atribuible a BullsEye"]];
  s["datos-nuevas"] = table([{ h: "Propiedad", f: (r) => `<b>${esc(r[0])}</b>` }, { h: "Objeto", f: (r) => r[1] }, { h: "Formato", s: 1, f: (r) => esc(r[2]) }, { h: "Habilita", s: 1, f: (r) => esc(r[3]) }], nw);
  return s;
}
