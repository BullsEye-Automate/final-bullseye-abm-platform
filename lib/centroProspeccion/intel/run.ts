import { supabaseAdmin } from "@/lib/supabase";
import { getClientModel } from "@/lib/claude";
import { getClientIcpText } from "@/lib/wishlist";
import { hubspotTokenFor, loadClientSettings, loadSnapshot } from "@/lib/radarAbm/server/store";
import { compact, loadClientLinks } from "../portalLink";
import { writeDoc } from "../store";
import { computeNumbers, type IntelNumbers } from "./numbers";
import { readWeekFeed, scrubPii, type FeedItem } from "./hubspotFeed";
import { analyzeWeek, type IntelResult } from "./analyze";
import { goalText, loadGoalsByClient, MET_GOAL_CAP, type ClientGoal } from "./goals";

// Inteligencia de la semana de un cliente: junta la evidencia, llama a la IA
// y guarda el resultado en centro_intel (una fila por cliente y semana).
// También deja un resumen legible en centro_docs/resultados para que la
// tarea programada del viernes ("Propuesta" del plan) lo lea por el conector.

const DAY = 86_400_000;
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+\n/g, "\n").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

// Fecha de Chile (AAAA-MM-DD)
export function chileDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
}
// Lunes de la semana que se planifica: el próximo lunes (o hoy si es lunes)
export function planningMonday(d = new Date()): string {
  const today = new Date(`${chileDate(d)}T12:00:00Z`);
  const w = today.getUTCDay();
  const add = w === 1 ? 0 : (8 - w) % 7;
  return new Date(today.getTime() + add * DAY).toISOString().slice(0, 10);
}

export type IntelRow = {
  id: string;
  client_id: string;
  semana: string;
  status: "ok" | "sin_datos" | "error";
  numbers: IntelNumbers | Record<string, never>;
  result: IntelResult | Record<string, never>;
  error: string | null;
  model: string | null;
  cost_usd: number | null;
  generated_at: string;
  updated_at: string;
  updated_by: string | null;
};

const FICHA_FIELDS: [string, string][] = [
  ["Perfil de empresa", "icp"], ["Industrias objetivo", "industrias"], ["Zonas", "zonas"],
  ["Cargos objetivo", "cargos"], ["Exclusiones", "exclusiones"], ["Próximos pasos", "proximos"],
];

function fichaText(fichas: { id: string; data: Record<string, unknown> }[]): string {
  return fichas.map((f) => {
    const lines = [`Ficha: ${clip(f.data.nombre || f.id, 120)}`];
    for (const [label, key] of FICHA_FIELDS) {
      const v = clip(f.data[key], 1500);
      if (v) lines.push(`${label}: ${v}`);
    }
    return lines.join("\n");
  }).join("\n---\n");
}

function feedText(items: FeedItem[], max: number): string {
  let out = "";
  for (const it of items) {
    const line = `- [${it.fecha}${it.sdr ? ` · ${it.sdr}` : ""} · ${it.kind}] ${it.texto.replace(/\n+/g, " / ")}\n`;
    if (out.length + line.length > max) break;
    out += line;
  }
  return out.trim();
}

type SignalRow = {
  contact_company: string | null; contact_job_title: string | null; call_date: string | null;
  signals: { categoria?: string; evidencia?: string; tipo_senal?: string; periodo?: string }[] | null;
  mentioned_companies: { nombre?: string; tipo?: string }[] | null;
  recommended_action: string | null; follow_up_date: string | null; crm_summary: string | null;
};

export async function runClientIntel(clientId: string, by = "cron"): Promise<IntelRow> {
  const db = supabaseAdmin();
  const semana = planningMonday();
  const now = Date.now();
  const since7 = chileDate(new Date(now - 7 * DAY));
  const since14 = new Date(now - 14 * DAY).toISOString();
  const since30 = new Date(now - 30 * DAY).toISOString();

  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");

  const save = async (row: Partial<IntelRow>) => {
    const { data, error } = await db.from("centro_intel").upsert({
      client_id: clientId, semana, updated_at: new Date().toISOString(), updated_by: by, generated_at: new Date().toISOString(), ...row,
    }, { onConflict: "client_id,semana" }).select("*").single();
    if (error) throw new Error(error.message);
    return data as IntelRow;
  };

  try {
    const [links, snap, settings, icp, model] = await Promise.all([
      loadClientLinks(),
      loadSnapshot(clientId, "full").catch(() => null),
      loadClientSettings(clientId).catch(() => null),
      getClientIcpText(db, clientId).catch(() => ""),
      getClientModel(db, clientId),
    ]);
    const ds = snap?.dataset ?? null;
    const numbers = computeNumbers(ds);
    // Meta de reuniones del mes (pestaña Asignación + planilla de reuniones)
    let goal: ClientGoal | null = null;
    try {
      goal = (await loadGoalsByClient(chileDate()))[clientId] ?? null;
    } catch (e) {
      console.warn("[centro-intel] meta del mes:", (e as Error).message);
    }
    const fichas = (links.fichasByClient.get(clientId) ?? []).filter((f) => f.data.estado !== "pausado");

    // HubSpot: llamadas y notas de los SDR sobre empresas / contactos del cliente
    const coIds = new Set((ds?.client.companies ?? []).map((c) => String(c.id)));
    const ctIds = new Set((ds?.client.contacts ?? []).map((c) => String(c.id)));
    const coName = new Map((ds?.client.companies ?? []).map((c) => [String(c.id), c.n]));
    let hubspot = "";
    let minutas = "";
    try {
      const token = settings?.hubspot_source === "client" ? await hubspotTokenFor(clientId, "client") : undefined;
      const feed = await readWeekFeed(since7, token);
      const mine = feed.filter((it) => it.kind !== "minuta" && (it.cos.some((c) => coIds.has(c)) || it.cts.some((c) => ctIds.has(c))));
      hubspot = feedText(mine.map((it) => {
        const emp = it.cos.map((c) => coName.get(c)).find(Boolean);
        return emp ? { ...it, texto: `${emp}: ${it.texto}` } : it;
      }), 24_000);
      // Minutas de reuniones con el cliente (diio), por nombre del cliente
      const key = compact(client.name);
      const mins = feed.filter((it) => it.kind === "minuta" && key.length >= 3 && compact(it.texto.slice(0, 600)).includes(key));
      minutas = feedText(mins, 8_000);
    } catch (e) {
      hubspot = `(No se pudo leer HubSpot: ${(e as Error).message.slice(0, 160)})`;
    }

    // Señales de las llamadas de Allo (cron analyze-allo-calls)
    const { data: sigs } = await db.from("allo_call_signals")
      .select("contact_company, contact_job_title, call_date, signals, mentioned_companies, recommended_action, follow_up_date, crm_summary")
      .eq("client_id", clientId).gte("call_date", since14).order("call_date", { ascending: false }).limit(80);
    const senales = clip((sigs as SignalRow[] | null ?? []).map((s) => {
      const sg = (s.signals ?? []).map((x) => `${x.categoria ?? ""}${x.tipo_senal ? `/${x.tipo_senal}` : ""}${x.periodo ? ` (${x.periodo})` : ""}: ${x.evidencia ?? ""}`).join(" | ");
      const mc = (s.mentioned_companies ?? []).map((m) => `${m.nombre} (${m.tipo})`).join(", ");
      return `- [${(s.call_date ?? "").slice(0, 10)}] ${s.contact_company ?? "s/e"} · ${s.contact_job_title ?? "s/c"}: ${sg || s.crm_summary || ""}${mc ? ` · menciona: ${mc}` : ""}${s.follow_up_date ? ` · retomar ${s.follow_up_date}` : ""}${s.recommended_action ? ` · acción: ${s.recommended_action}` : ""}`;
    }).join("\n"), 16_000);

    // Rechazos del cliente (wishlist) últimos 30 días
    const { data: rej } = await db.from("client_wishlist")
      .select("company_name, client_reject_reason, client_decision_at")
      .eq("client_id", clientId).eq("status", "rejected_by_client").gte("client_decision_at", since30).limit(60);
    const rechazos = (rej ?? []).map((r: { company_name: string; client_reject_reason: string | null }) => `- ${r.company_name}: ${r.client_reject_reason || "sin motivo"}`).join("\n");

    // Feedback de reuniones (encuesta del cliente + planilla) últimos 30 días
    const d30 = chileDate(new Date(now - 30 * DAY));
    const feedback = clip((ds?.client.meetings ?? [])
      .filter((m) => (m.fecha || m.agendada || "") >= d30 && (m.com || m.fb || m.prop || m.cal != null || m.st === "No-show"))
      .map((m) => `- ${m.emp || coName.get(String(m.co)) || "s/e"} · ${m.cargo || "s/c"} · ${m.st}${m.cal != null ? ` · nota ${m.cal}` : ""}${m.prop ? ` · propuesta: ${m.prop}` : ""}${m.okct === false ? " · contacto no calificado" : ""}${m.icpfit === false ? " · fuera de ICP" : ""}${m.com || m.fb ? ` · ${m.com || m.fb}` : ""}`)
      .join("\n"), 8_000);

    if (!numbers && !hubspot && !senales && !rechazos) {
      return await save({ status: "sin_datos", numbers: {}, result: {}, error: "Sin Pulso ABM ni actividad de la semana", model: null, cost_usd: null });
    }

    const { result, costIn, costOut } = await analyzeWeek({
      clientId, cliente: client.name, semana, numbers,
      ficha: fichaText(fichas), icp,
      senales: scrubPii(senales), hubspot: scrubPii(hubspot), minutas: scrubPii(minutas),
      rechazos: scrubPii(rechazos), feedback: scrubPii(feedback),
      meta: goalText(goal),
    }, model);
    // Meta del mes cumplida: se baja el ritmo (tope fijo, aunque la IA proponga más)
    if (goal?.cumplida && result.empresas_sugeridas > MET_GOAL_CAP) {
      result.empresas_sugeridas = MET_GOAL_CAP;
      result.motivo_cantidad = `Meta de ${goal.mes} cumplida (${goal.realizadas} de ${goal.meta} realizadas): se baja el ritmo a ${MET_GOAL_CAP} empresas para no dejar sin cuentas el mes siguiente. ${result.motivo_cantidad}`;
    }
    // Mantiene las decisiones si se vuelve a generar la misma semana
    const { data: prev } = await db.from("centro_intel").select("result").eq("client_id", clientId).eq("semana", semana).maybeSingle();
    const prevProps = ((prev?.result as IntelResult | undefined)?.propuestas ?? []).filter((p) => p.estado && p.estado !== "pendiente");
    if (prevProps.length) result.propuestas = [...prevProps, ...result.propuestas.filter((p) => !prevProps.some((q) => q.texto === p.texto)).map((p, i) => ({ ...p, id: `p${prevProps.length + i + 1}` }))];

    const price = /haiku/i.test(model) ? [1, 5] : /opus/i.test(model) ? [15, 75] : [3, 15];
    const cost = (costIn / 1e6) * price[0] + (costOut / 1e6) * price[1];
    const row = await save({ status: "ok", numbers: { ...(numbers ?? {}), ...(goal ? { meta: goal } : {}) } as IntelRow["numbers"], result, error: null, model, cost_usd: Math.round(cost * 10000) / 10000 });
    await writeSummaryDoc(client.name, fichas.map((f) => f.id), row).catch((e) => console.warn("[centro-intel] resumen:", (e as Error).message));
    return row;
  } catch (e) {
    return await save({ status: "error", error: (e as Error).message.slice(0, 500), numbers: {}, result: {} });
  }
}

// Resumen en texto para las tareas programadas (conector MCP: colección resultados)
async function writeSummaryDoc(cliente: string, fichaIds: string[], row: IntelRow) {
  const r = row.result as IntelResult;
  const n = row.numbers as IntelNumbers;
  const texto = [
    `Inteligencia de la semana del ${row.semana} — ${cliente}`,
    r.resumen,
    `Empresas sugeridas: ${r.empresas_sugeridas} (prioridad ${r.prioridad}). ${r.motivo_cantidad}`,
    n?.sinGestion != null ? `Stock SDR: ${n.sinGestion} contactos sin gestionar, ${n.diasStock ?? "s/i"} días al ritmo actual.` : "",
    r.donde_prospectar.length ? `Dónde prospectar: ${r.donde_prospectar.join("; ")}` : "",
    r.propuestas.length ? `Propuestas para la ficha:\n${r.propuestas.map((p) => `- [${p.estado}] ${p.tipo}: ${p.texto} (${p.casos} casos) — ${p.evidencia}`).join("\n")}` : "",
    r.calidad_datos.length ? `Calidad de datos:\n${r.calidad_datos.map((x) => `- ${x}`).join("\n")}` : "",
    r.minuta ? `Reuniones con el cliente: ${r.minuta}` : "",
  ].filter(Boolean).join("\n\n");
  await writeDoc({
    collection: "resultados",
    docId: `intel_${row.semana}_${row.client_id.slice(0, 8)}`,
    data: { tipo: "inteligencia", semana: row.semana, cliente, clientId: row.client_id, fichas: fichaIds, texto, actualizado: new Date().toISOString() },
    mode: "set", by: "inteligencia", source: "automation",
  });
}
