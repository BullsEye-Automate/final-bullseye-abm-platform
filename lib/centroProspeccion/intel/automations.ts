import { supabaseAdmin } from "@/lib/supabase";
import { readMaster } from "@/lib/celulasSdr/sheets";
import { leaderEmail } from "@/lib/celulasSdr/server/alertsMail";
import { kamFor, readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";
import { RecoInputError, runRecommendationRound } from "@/lib/wishlistRecommendations";
import { loadClientLinks } from "../portalLink";
import { readDocs } from "../store";
import { loadProspectoraCalendar } from "./prospectoraDays";
import type { IntelResult } from "./analyze";
import type { IntelNumbers } from "./numbers";
import { chileDate, planningMonday } from "./run";
import { APP_URL, CENTRO_LEADER, PROSPECTORAS, esc, sendCentroMail, wrapMail } from "./mail";

// Automatizaciones del Centro de prospección sobre el motor de José Antonio:
//  - domingo: recomendaciones IA de empresas por cliente (misma tanda de
//    Empresas → Recomendadas por IA), en la cantidad que sugiere la
//    inteligencia; quedan pendientes para que la prospectora y la líder las
//    revisen antes de proponerlas al cliente;
//  - lunes: correo del plan a prospectoras y líder + reporte de costo de IA;
//  - lunes a viernes: alertas (propuestas sin respuesta del cliente → KAM;
//    revisión acumulada → prospectora; poco stock y errores de Lemlist →
//    líder) y recordatorios de llamadas a los SDR y su líder de célula.

const DAY = 86_400_000;
const CLIENT_BUDGET_MS = 240_000;
const RECO_CAP = 80;
const RECO_DEFAULT = 20;
// Mínimo por cliente aunque la inteligencia sugiera menos (pedido de BullsEye, 13-nov-2026:
// normalmente se piden al menos 20 empresas, también a los clientes con stock de sobra)
const RECO_MIN = 20;

// ---------- marcas en allo_response_cache ----------
async function getFlag<T = unknown>(key: string): Promise<T | null> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("response, expires_at").eq("cache_key", key).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.response as T;
}
async function setFlag(key: string, value: unknown, days: number) {
  await supabaseAdmin().from("allo_response_cache").upsert({ cache_key: key, response: value as object, expires_at: new Date(Date.now() + days * DAY).toISOString() });
}

type IntelLite = { client_id: string; semana: string; status: string; numbers: IntelNumbers; result: IntelResult };
async function latestIntel(): Promise<IntelLite[]> {
  const db = supabaseAdmin();
  const { data: last } = await db.from("centro_intel").select("semana").order("semana", { ascending: false }).limit(1);
  const semana = (last?.[0] as { semana?: string } | undefined)?.semana;
  if (!semana) return [];
  const { data } = await db.from("centro_intel").select("client_id, semana, status, numbers, result").eq("semana", semana);
  return (data ?? []) as IntelLite[];
}

// ---------- domingo: recomendaciones IA ----------
export type RecoRun = { client_id: string; objetivo: number; pendientes_antes: number; nuevas: number; tandas: number; estado: string; corridas?: number };
const MAX_RECO_RUNS = 3;
const recoKey = (semana: string, clientId: string) => `centro_reco:${semana}:${clientId}`;

// El domingo el cron pasa varias veces: un cliente queda listo cuando juntó la
// cantidad sugerida, terminó por otro motivo (sin ICP, se agotaron, error) o ya
// tuvo MAX_RECO_RUNS corridas de ~4 min (las que quedan cortas siguen después).
export async function recoDone(clientId: string): Promise<boolean> {
  const f = await getFlag<RecoRun>(recoKey(planningMonday(), clientId));
  if (!f) return false;
  if (f.estado.startsWith("error")) return (f.corridas ?? 1) >= MAX_RECO_RUNS;
  return f.estado !== "ok" || f.pendientes_antes + f.nuevas >= f.objetivo || (f.corridas ?? 1) >= MAX_RECO_RUNS;
}

// ---------- plan semanal del Centro (colección "plan") ----------
// Fusión plan + inteligencia (pedido de BullsEye, 16-nov-2026): el Plan semanal
// manda. La propuesta del viernes (tarea programada) ya lee la inteligencia;
// la líder la edita y aprueba, y de ahí salen las recomendaciones del domingo y
// el correo del lunes. Se usan las filas aprobadas; si aún no hay, la propuesta.
export type PlanRow = { id: string; email: string; fichaId: string; meta: number; prioridad: number; nota: string; estado: string };
export async function loadWeekPlan(semana: string): Promise<{ rows: PlanRow[]; approved: boolean }> {
  const all = (await readDocs(["plan"]))
    .filter((d) => String(d.data?.semana ?? "") === semana)
    .map((d) => ({
      id: d.doc_id,
      email: String(d.data?.email ?? "").trim().toLowerCase(),
      fichaId: String(d.data?.clienteId ?? ""),
      meta: Number(d.data?.meta ?? 0) || 0,
      prioridad: Number(d.data?.prioridad ?? 9) || 9,
      nota: String(d.data?.nota ?? d.data?.motivo ?? ""),
      estado: String(d.data?.estado ?? ""),
    }))
    .filter((r) => r.email && r.fichaId);
  const approved = all.filter((r) => r.estado && r.estado !== "propuesta");
  return approved.length ? { rows: approved, approved: true } : { rows: all, approved: false };
}

export async function runClientRecommendations(clientId: string): Promise<RecoRun> {
  const db = supabaseAdmin();
  const started = Date.now();
  const semana = planningMonday();
  const { data: intel } = await db.from("centro_intel").select("result, status").eq("client_id", clientId).eq("semana", semana).maybeSingle();
  const sugeridas = intel?.status === "ok" ? Number((intel.result as IntelResult).empresas_sugeridas) : NaN;
  // Cantidad: la meta del cliente en el Plan semanal (suma de prospectoras); sin
  // plan, lo que sugirió la inteligencia. Siempre al menos RECO_MIN.
  const [links, week] = await Promise.all([loadClientLinks(), loadWeekPlan(semana)]);
  const fichaIds = new Set((links.fichasByClient.get(clientId) ?? []).map((f) => f.id));
  const planMeta = week.rows.filter((r) => fichaIds.has(r.fichaId)).reduce((a, r) => a + r.meta, 0);
  const base = planMeta > 0 ? planMeta : Number.isFinite(sugeridas) ? sugeridas : RECO_DEFAULT;
  const objetivo = Math.min(RECO_CAP, Math.max(RECO_MIN, base));
  const { count } = await db.from("client_recommendations").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "pending");
  const pendientes = count ?? 0;
  const need = Math.max(0, objetivo - pendientes);
  // Corrida anterior de la misma semana: se acumula (el correo del lunes muestra el total)
  const prev = await getFlag<RecoRun>(recoKey(semana, clientId));
  const out: RecoRun = prev
    ? { ...prev, objetivo, estado: "ok", corridas: (prev.corridas ?? 1) + 1 }
    : { client_id: clientId, objetivo, pendientes_antes: pendientes, nuevas: 0, tandas: 0, estado: "ok", corridas: 1 };
  if (!need) out.estado = "ya hay suficientes pendientes";
  // Mismos topes que la pantalla: ~cantidad/5 + 2 tandas, corta tras 4 tandas seguidas sin empresas buenas
  const maxRounds = Math.ceil(need / 5) + 2;
  let empty = 0;
  let added = 0;
  let rounds = 0;
  try {
    while (need && added < need && rounds < maxRounds && empty < 4 && Date.now() - started < CLIENT_BUDGET_MS) {
      const r = await runRecommendationRound(db, clientId);
      rounds++;
      out.tandas++;
      added += r.cards.length;
      out.nuevas += r.cards.length;
      empty = r.cards.length ? 0 : empty + 1;
      if (r.exhausted) { out.estado = "se agotaron las empresas con los filtros del ICP"; break; }
    }
    if (need && added < need && out.estado === "ok" && (empty >= 4 || rounds >= maxRounds)) out.estado = "no hubo más empresas con fit suficiente";
  } catch (e) {
    out.estado = e instanceof RecoInputError ? "sin ICP cargado" : `error: ${(e as Error).message.slice(0, 200)}`;
  }
  await setFlag(recoKey(semana, clientId), out, 14);
  return out;
}

// ---------- prospectora de cada ficha ----------
// La ficha no guarda la prospectora: sale del plan semanal del Centro (colección
// "plan", un documento por prospectora × ficha × semana, con su correo). Se usa
// la semana más reciente de cada ficha; sin plan, el aviso va solo a la líder.
const PROSPECTORA_NAME: Record<string, string> = {
  "gcondori@bullseye-abm.com": "Gia",
  "jnazar@bullseye-abm.com": "Javi",
  "nmoreno@bullseye-abm.com": "Nasly",
};
export async function loadPlanProspectoras(): Promise<Map<string, string[]>> {
  const latest = new Map<string, { semana: string; emails: Set<string> }>();
  for (const d of await readDocs(["plan"])) {
    const ficha = String(d.data?.clienteId ?? "");
    const email = String(d.data?.email ?? "").trim().toLowerCase();
    const semana = String(d.data?.semana ?? "");
    if (!ficha || !email.includes("@") || !PROSPECTORAS.includes(email)) continue;
    const cur = latest.get(ficha);
    if (!cur || semana > cur.semana) latest.set(ficha, { semana, emails: new Set([email]) });
    else if (semana === cur.semana) cur.emails.add(email);
  }
  return new Map(Array.from(latest).map(([k, v]) => [k, Array.from(v.emails)]));
}
const prospectorasDe = (plan: Map<string, string[]>, fichaIds: string[]) =>
  Array.from(new Set(fichaIds.flatMap((id) => plan.get(id) ?? [])));

// ---------- lunes: plan de la semana ----------
// Un correo por prospectora con SU plan aprobado (clientes, meta de empresas,
// prioridad y nota del plan) y, por cliente, el contexto de la inteligencia
// (prioridad, meta de reuniones del mes, foco) y cuántas recomendaciones
// quedaron listas. A la líder, el resumen de todos. Sin plan aprobado, las
// prospectoras no reciben nada y la líder recibe el aviso.
export async function sendMondayMail(opts: { to?: string[]; late?: boolean; leader?: boolean } = {}): Promise<Record<string, unknown>> {
  const semana = planningMonday();
  const [intel, links, week] = await Promise.all([latestIntel(), loadClientLinks(), loadWeekPlan(semana)]);
  const clientOfFicha = new Map<string, string>();
  for (const [cid, fs] of Array.from(links.fichasByClient)) for (const f of fs) clientOfFicha.set(f.id, cid);
  const fichaName = new Map(links.fichas.map((f) => [f.id, String(f.data.nombre || f.id)]));
  const intelBy = new Map(intel.filter((i) => i.status === "ok").map((i) => [i.client_id, i]));
  const recoBy = new Map<string, RecoRun | null>();
  for (const cid of Array.from(new Set(Array.from(clientOfFicha.values())))) recoBy.set(cid, await getFlag<RecoRun>(recoKey(semana, cid)));
  const color = { alta: "#c0392b", media: "#b7791f", baja: "#2f855a" } as const;

  const rowHtml = (r: PlanRow, withWho: boolean) => {
    const cid = clientOfFicha.get(r.fichaId);
    const i = cid ? intelBy.get(cid) : undefined;
    const g = (i?.numbers as { meta?: { meta: number; realizadas: number; faltan: number; cumplida: boolean } } | undefined)?.meta;
    const reco = cid ? recoBy.get(cid) : null;
    const ctx = i
      ? `<br><span style="color:${color[i.result.prioridad]}">Prioridad ${esc(i.result.prioridad)}</span>${g ? ` · reuniones del mes ${g.realizadas}/${g.meta}${g.cumplida ? " (cumplida)" : ""}` : ""}${i.result.donde_prospectar.length ? `<br><span style="color:#555">Foco: ${esc(i.result.donde_prospectar.slice(0, 3).join("; "))}</span>` : ""}`
      : "";
    return `<tr style="border-top:1px solid #eee"><td style="padding:6px"><b>${esc(fichaName.get(r.fichaId) ?? r.fichaId)}</b>${withWho ? `<br><span style="color:#777">${esc(PROSPECTORA_NAME[r.email] ?? r.email)}</span>` : ""}${r.nota ? `<br><span style="color:#555">${esc(r.nota)}</span>` : ""}${ctx}</td>
<td align="center" style="padding:6px">${r.prioridad}</td><td align="right" style="padding:6px"><b>${r.meta}</b></td><td align="right" style="padding:6px">${reco ? reco.pendientes_antes + reco.nuevas : "–"}</td></tr>`;
  };
  const table = (rows: PlanRow[], withWho: boolean) =>
    `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f3f2fa"><th align="left" style="padding:6px">Cliente</th><th style="padding:6px">Prioridad</th><th align="right" style="padding:6px">Meta de empresas</th><th align="right" style="padding:6px">Recomendadas listas</th></tr>${rows.sort((a, b) => a.prioridad - b.prioridad).map((r) => rowHtml(r, withWho)).join("")}</table>`;
  const foot = `<p style="color:#666">Las recomendadas están en <b>Centro de prospección → Empresas → Recomendadas por IA</b> (elige el cliente): revisa, descarta las que no sirven y propón el resto al cliente. Si necesitas más, usa «Generar más».</p>`;

  const out: Record<string, unknown> = { semana, planAprobado: week.approved };
  const targets = (opts.to ?? PROSPECTORAS).map((e) => e.toLowerCase());
  if (week.approved) {
    for (const e of targets) {
      const mine = week.rows.filter((r) => r.email === e);
      if (!mine.length) { out[e] = "sin asignaciones en el plan"; continue; }
      const total = mine.reduce((a, r) => a + r.meta, 0);
      const nombre = PROSPECTORA_NAME[e] ?? "";
      out[e] = await sendCentroMail({
        to: [e],
        subject: `Tu plan de la semana del ${semana}${opts.late ? " (te llega hoy por el feriado)" : ""}`,
        html: wrapMail(`Tu plan · semana del ${semana}`, `<p>Hola${nombre ? ` ${esc(nombre)}` : ""}: esta es tu semana, ${total} empresas en total.</p>${table(mine, false)}${foot}`, { href: `${APP_URL}/centro-prospeccion`, label: "Abrir el Centro de prospección" }),
      }).then(() => mine.length).catch((err) => ({ error: (err as Error).message }));
    }
  }
  if (opts.leader !== false) {
    const body = week.rows.length
      ? `${week.approved ? "" : `<p style="color:#c0392b"><b>El plan de esta semana aún no está aprobado</b>: las prospectoras no recibieron su correo. Apruébalo en Plan semanal y se lo reenvío al día siguiente, o escríbeles tú.</p>`}${table([...week.rows], true)}${foot}`
      : `<p style="color:#c0392b"><b>No hay plan para la semana del ${esc(semana)}</b> en el Centro: las prospectoras no recibieron su correo.</p>`;
    out.lider = await sendCentroMail({ to: [CENTRO_LEADER], subject: `Plan de prospección · semana del ${semana}`, html: wrapMail(`Plan de prospección · semana del ${semana}`, body, { href: `${APP_URL}/centro-prospeccion`, label: "Abrir el Centro de prospección" }) })
      .then(() => "ok").catch((err) => ({ error: (err as Error).message }));
  }
  return out;
}

// ---------- lunes: costo de IA ----------
type UsageRow = { function_name: string; client_id: string | null; cost_usd: number | null; created_at: string };
async function usageSince(fromIso: string): Promise<UsageRow[]> {
  const db = supabaseAdmin();
  const out: UsageRow[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await db.from("ai_usage_log").select("function_name, client_id, cost_usd, created_at").gte("created_at", fromIso).order("created_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as UsageRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const FUNCTION_LABEL: Record<string, string> = {
  centro_inteligencia_semanal: "Centro · inteligencia de la semana",
  portal_wishlist_fit: "Empresas · fit con el ICP",
  allo_call_signal_analysis: "Allo · señales de llamadas",
};

export async function sendWeeklyCostReport(): Promise<{ total: number; prev: number }> {
  const now = Date.now();
  const rows = await usageSince(new Date(now - 14 * DAY).toISOString());
  const cut = new Date(now - 7 * DAY).toISOString();
  const cur = rows.filter((r) => r.created_at >= cut);
  const prev = rows.filter((r) => r.created_at < cut);
  const sum = (xs: UsageRow[]) => xs.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
  const by = (xs: UsageRow[], key: (r: UsageRow) => string) => {
    const m = new Map<string, number>();
    for (const r of xs) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.cost_usd ?? 0));
    return m;
  };
  const links = await loadClientLinks();
  const name = new Map(links.clients.map((c) => [c.id, c.name]));
  const fnCur = by(cur, (r) => r.function_name), fnPrev = by(prev, (r) => r.function_name);
  const clCur = by(cur, (r) => r.client_id ?? "—"), clPrev = by(prev, (r) => r.client_id ?? "—");
  const usd = (n: number) => `US$${n.toFixed(2)}`;
  const vari = (a: number, b: number) => (b > 0.005 ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : a > 0.005 ? "nuevo" : "–");
  const table = (title: string, curM: Map<string, number>, prevM: Map<string, number>, label: (k: string) => string) => {
    const keys = Array.from(new Set([...Array.from(curM.keys()), ...Array.from(prevM.keys())])).sort((a, b) => (curM.get(b) ?? 0) - (curM.get(a) ?? 0)).slice(0, 15);
    return `<h3 style="font-size:15px;margin:18px 0 6px">${esc(title)}</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f3f2fa"><th align="left" style="padding:5px">Detalle</th><th align="right" style="padding:5px">Esta semana</th><th align="right" style="padding:5px">Anterior</th><th align="right" style="padding:5px">Variación</th></tr>${keys.map((k) => `<tr style="border-top:1px solid #eee"><td style="padding:5px">${esc(label(k))}</td><td align="right" style="padding:5px">${usd(curM.get(k) ?? 0)}</td><td align="right" style="padding:5px">${usd(prevM.get(k) ?? 0)}</td><td align="right" style="padding:5px">${vari(curM.get(k) ?? 0, prevM.get(k) ?? 0)}</td></tr>`).join("")}</table>`;
  };
  const total = sum(cur), totalPrev = sum(prev);
  const body = `<p style="font-size:16px">Gasto de IA de la plataforma en los últimos 7 días: <b>${usd(total)}</b> (semana anterior ${usd(totalPrev)}, ${vari(total, totalPrev)}).</p>
${table("Por automatización", fnCur, fnPrev, (k) => FUNCTION_LABEL[k] ?? k)}
${table("Por cliente", clCur, clPrev, (k) => (k === "—" ? "Sin cliente" : name.get(k) ?? k))}
<p style="color:#666">Fuente: registro de uso de IA (ai_usage_log), el mismo de Administración → Uso de IA.</p>`;
  await sendCentroMail({ to: [CENTRO_LEADER], subject: `Costo de IA · ${usd(total)} esta semana (${vari(total, totalPrev)})`, html: wrapMail("Costo de IA de la semana", body, { href: `${APP_URL}/admin/uso-ia`, label: "Ver uso de IA" }) });
  return { total, prev: totalPrev };
}

// ---------- lunes a viernes: alertas ----------
export async function sendDailyAlerts(today = chileDate()): Promise<Record<string, unknown>> {
  const db = supabaseAdmin();
  const cal = await loadProspectoraCalendar();
  const [links, intel, plan] = await Promise.all([loadClientLinks(), latestIntel(), loadPlanProspectoras()]);
  const name = new Map(links.clients.map((c) => [c.id, c.name]));
  const cname = (id: string) => name.get(id) ?? id;
  const sent: Record<string, unknown> = {};

  // 1) Propuestas al cliente sin respuesta hace más de 7 días → KAM
  const { data: stale } = await db.from("client_wishlist").select("client_id, company_name, created_at").eq("status", "proposed").lt("created_at", new Date(Date.now() - 7 * DAY).toISOString()).limit(5000);
  const byKam = new Map<string, Map<string, { n: number; oldest: string }>>();
  for (const r of (stale ?? []) as { client_id: string; created_at: string }[]) {
    const kam = kamFor(cname(r.client_id));
    const m = byKam.get(kam) ?? new Map();
    const x = m.get(r.client_id) ?? { n: 0, oldest: r.created_at };
    x.n++; if (r.created_at < x.oldest) x.oldest = r.created_at;
    m.set(r.client_id, x); byKam.set(kam, m);
  }
  for (const [kam, m] of Array.from(byKam)) {
    const items = Array.from(m).map(([id, x]) => `<li><b>${esc(cname(id))}</b>: ${x.n} empresas propuestas sin respuesta (la más antigua del ${x.oldest.slice(0, 10)})</li>`).join("");
    sent[`kam:${kam}`] = await sendCentroMail({ to: [kam], cc: [CENTRO_LEADER], subject: "Clientes con empresas propuestas sin responder", html: wrapMail("Propuestas sin respuesta del cliente", `<p>Estos clientes tienen empresas propuestas por BullsEye en su portal hace más de 7 días sin aprobar ni rechazar. Mientras no respondan no se prospectan.</p><ul>${items}</ul>`) }).catch((e) => ({ error: (e as Error).message }));
  }

  // 2) Revisión acumulada (contactos IA sugeridos sin revisar) → prospectora de la ficha
  const { data: sug } = await db.from("wishlist_contacts").select("client_id").eq("status", "suggested").limit(20000);
  const sugCount = new Map<string, number>();
  for (const r of (sug ?? []) as { client_id: string }[]) sugCount.set(r.client_id, (sugCount.get(r.client_id) ?? 0) + 1);
  const { data: recos } = await db.from("client_recommendations").select("client_id, updated_at").eq("status", "pending").lt("updated_at", new Date(Date.now() - 3 * DAY).toISOString()).limit(20000);
  const recoCount = new Map<string, number>();
  for (const r of (recos ?? []) as { client_id: string }[]) recoCount.set(r.client_id, (recoCount.get(r.client_id) ?? 0) + 1);
  const byProsp = new Map<string, string[]>();
  for (const id of Array.from(new Set([...Array.from(sugCount.keys()), ...Array.from(recoCount.keys())]))) {
    const s = sugCount.get(id) ?? 0, rc = recoCount.get(id) ?? 0;
    if (s < 30 && rc < 30) continue;
    const fichas = links.fichasByClient.get(id) ?? [];
    const asignadas = prospectorasDe(plan, fichas.map((f) => f.id));
    for (const e of asignadas.length ? asignadas : [CENTRO_LEADER]) {
      const l = byProsp.get(e) ?? [];
      l.push(`<li><b>${esc(cname(id))}</b>: ${s >= 30 ? `${s} contactos IA por revisar` : ""}${s >= 30 && rc >= 30 ? " · " : ""}${rc >= 30 ? `${rc} empresas recomendadas sin revisar hace 3+ días` : ""}</li>`);
      byProsp.set(e, l);
    }
  }
  for (const [e, l] of Array.from(byProsp)) {
    const off = cal.offReason(e, today);
    if (off) { sent[`prosp:${e}`] = `no se envía: ${off}`; continue; }
    sent[`prosp:${e}`] = await sendCentroMail({ to: [e], subject: "Revisión pendiente en Empresas y Contactos", html: wrapMail("Revisión acumulada", `<p>Se está acumulando trabajo por revisar:</p><ul>${l.join("")}</ul>`, { href: `${APP_URL}/centro-prospeccion?tab=contactos`, label: "Revisar" }) }).catch((err) => ({ error: (err as Error).message }));
  }

  // 3) Poco stock de los SDR y errores de Lemlist → líder
  const low = intel.filter((i) => i.status === "ok" && i.numbers?.diasStock != null && i.numbers.diasStock < 5);
  const { data: lemErr } = await db.from("client_wishlist").select("client_id").eq("lemlist_status", "error").limit(5000);
  const errCount = new Map<string, number>();
  for (const r of (lemErr ?? []) as { client_id: string }[]) errCount.set(r.client_id, (errCount.get(r.client_id) ?? 0) + 1);
  if (low.length || errCount.size) {
    const body = `${low.length ? `<p><b>Clientes con poco stock para los SDR</b> (menos de 5 días hábiles de contactos sin gestionar):</p><ul>${low.map((i) => `<li><b>${esc(cname(i.client_id))}</b>: ${i.numbers.sinGestion} contactos, ~${i.numbers.diasStock} días al ritmo actual</li>`).join("")}</ul>` : ""}
${errCount.size ? `<p><b>Empresas que no llegaron a Lemlist</b> (se reintentan desde el Dashboard):</p><ul>${Array.from(errCount).map(([id, n]) => `<li><b>${esc(cname(id))}</b>: ${n}</li>`).join("")}</ul>` : ""}`;
    sent.lider = await sendCentroMail({ to: [CENTRO_LEADER], subject: "Alertas de prospección del día", html: wrapMail("Alertas de prospección", body, { href: `${APP_URL}/centro-prospeccion?tab=dashboard`, label: "Abrir el Dashboard" }) }).catch((e) => ({ error: (e as Error).message }));
  }

  sent.recordatorios = await sendReminders(intel, cname, today).catch((e) => ({ error: (e as Error).message }));
  return sent;
}

// ---------- recordatorios a los SDR y su líder de célula ----------
function reminderDue(cuando: string, today: string): boolean {
  const t = new Date(`${today}T12:00:00Z`).getTime();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cuando)) {
    const d = new Date(`${cuando}T12:00:00Z`).getTime();
    return t >= d - 2 * DAY && t <= d + 14 * DAY; // 2 días antes, hasta 2 semanas después
  }
  if (/^\d{4}-\d{2}$/.test(cuando)) {
    const d = new Date(`${cuando}-01T12:00:00Z`).getTime();
    return t >= d && t <= d + 14 * DAY; // primeros días del mes pedido
  }
  return false;
}

async function sendReminders(intel: IntelLite[], cname: (id: string) => string, today: string) {
  const due: { key: string; cliente: string; r: IntelResult["recordatorios"][number] }[] = [];
  for (const i of intel) {
    for (const r of i.result?.recordatorios ?? []) {
      if (!reminderDue(String(r.cuando ?? ""), today)) continue;
      const key = `centro_reminder:${i.client_id}:${(r.empresa + "|" + r.contacto + "|" + r.cuando).toLowerCase().replace(/[^a-z0-9|:-]+/g, "").slice(0, 150)}`;
      if (await getFlag(key)) continue;
      due.push({ key, cliente: cname(i.client_id), r });
    }
  }
  if (!due.length) return { enviados: 0 };
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID ?? "";
  const [people, master] = await Promise.all([readMasterPeople().catch(() => []), spreadsheetId ? readMaster(spreadsheetId, []).catch(() => null) : Promise.resolve(null)]);
  const allLeaders = (master?.cells ?? []).map((c) => leaderEmail(c.leader)).filter((x): x is string => !!x);
  const groups = new Map<string, { to: string[]; cc: string[]; sdr: string; items: typeof due }>();
  for (const d of due) {
    const res = resolveSdr(people, d.r.sdr);
    let to: string[]; let cc: string[]; let sdr = d.r.sdr || "sin SDR identificado";
    if (res.ok && res.person.email) {
      sdr = res.person.name;
      to = [res.person.email];
      const cell = master?.cells.find((c) => c.leader === res.person.name || c.members.includes(res.person.name));
      const le = cell ? leaderEmail(cell.leader) : null;
      cc = le ? [le] : allLeaders;
    } else {
      to = allLeaders.length ? allLeaders : [CENTRO_LEADER];
      cc = [];
    }
    const gk = to.join(",");
    const g = groups.get(gk) ?? { to, cc, sdr, items: [] };
    g.items.push(d);
    groups.set(gk, g);
  }
  let enviados = 0;
  for (const g of Array.from(groups.values())) {
    const rows = g.items.map(({ cliente, r }) => `<li><b>${esc(r.empresa)}</b> (${esc(cliente)}) · ${esc(r.contacto)} · ${esc(r.cuando)}<br><span style="color:#555">${esc(r.motivo)}${r.sdr ? ` · llamó ${esc(r.sdr)}` : ""}</span></li>`).join("");
    try {
      await sendCentroMail({ to: g.to, cc: g.cc, subject: `Recordatorio: ${g.items.length === 1 ? `volver a llamar a ${g.items[0].r.empresa}` : `${g.items.length} prospectos para volver a llamar`}`, html: wrapMail("Prospectos que pidieron que los llamen ahora", `<p>Hola${g.sdr && !/sin SDR/.test(g.sdr) ? ` ${esc(g.sdr.split(" ")[0])}` : ""}: en llamadas anteriores estos prospectos pidieron que los contactaran en esta fecha. Revisa el historial en HubSpot antes de llamar.</p><ul>${rows}</ul>`) });
      for (const it of g.items) await setFlag(it.key, { sent: today }, 120);
      enviados += g.items.length;
    } catch (e) {
      console.warn("[centro] recordatorio:", (e as Error).message);
    }
  }
  return { enviados };
}

// ---------- cambios de ICP aprobados en la ficha → KAM, un solo correo al día ----------
// Antes cada aprobación mandaba un correo al KAM en el momento (13-nov-2026: muchas
// aprobaciones de noche = muchos correos a Ingri a esa hora). Ahora se acumulan y
// salen juntos en el correo de las 8:30 del día hábil siguiente.
export type IcpPending = { client_id: string; cliente: string; campo: string; texto: string; evidencia: string; casos: number; by: string; at: string };
const ICP_QUEUE = "centro_icp_validar:cola";
export async function queueIcpValidation(item: IcpPending) {
  for (let i = 0; i < 3; i++) {
    const { data } = await supabaseAdmin().from("allo_response_cache").select("response, expires_at").eq("cache_key", ICP_QUEUE).maybeSingle();
    const list = ((data?.response as IcpPending[] | undefined) ?? []);
    list.push(item);
    await setFlag(ICP_QUEUE, list, 60);
    // Relee: si otra aprobación escribió al mismo tiempo, vuelve a intentar
    const back = await getFlag<IcpPending[]>(ICP_QUEUE);
    if (back?.some((x) => x.at === item.at && x.texto === item.texto)) return;
  }
}
const CAMPO_LABEL: Record<string, string> = { cargos: "Cargos objetivo", industrias: "Industrias objetivo", exclusiones: "Exclusiones", zonas: "Zonas", proximos: "Próximos pasos" };
export async function sendIcpDigest(): Promise<Record<string, unknown>> {
  const list = (await getFlag<IcpPending[]>(ICP_QUEUE)) ?? [];
  if (!list.length) return { pendientes: 0 };
  const byKam = new Map<string, IcpPending[]>();
  for (const it of list) {
    const k = kamFor(it.cliente);
    byKam.set(k, [...(byKam.get(k) ?? []), it]);
  }
  const out: Record<string, unknown> = {};
  for (const [kam, items] of Array.from(byKam)) {
    const byClient = new Map<string, IcpPending[]>();
    for (const it of items) byClient.set(it.cliente, [...(byClient.get(it.cliente) ?? []), it]);
    const body = `<p>Prospección aprobó en la ficha cambios que tocan el ICP acordado con el cliente. Por favor valídalos con cada cliente y, si corresponde, actualiza el ICP en Sistema → ICP.</p>${Array.from(byClient).map(([c, xs]) => `<h3 style="font-size:15px;margin:16px 0 6px">${esc(c)}</h3><ul>${xs.map((x) => `<li><b>${esc(CAMPO_LABEL[x.campo] ?? x.campo)}:</b> ${esc(x.texto)}<br><span style="color:#666">Evidencia (${x.casos} casos): ${esc(x.evidencia)}</span></li>`).join("")}</ul>`).join("")}`;
    out[kam] = await sendCentroMail({ to: [kam], cc: [CENTRO_LEADER], subject: `Cambios de ICP para validar (${items.length})`, html: wrapMail("Cambios de ICP para validar", body, { href: `${APP_URL}/centro-prospeccion`, label: "Abrir el Centro de prospección" }) }).then(() => items.length).catch((e) => ({ error: (e as Error).message }));
  }
  if (!Object.values(out).some((v) => typeof v === "object")) await setFlag(ICP_QUEUE, [], 1);
  return out;
}

// ---------- plan del lunes pendiente para quien tuvo feriado ----------
export const planPendingKey = (semana: string, email: string) => `centro_plan_pendiente:${semana}:${email.toLowerCase()}`;

export { getFlag, setFlag };
