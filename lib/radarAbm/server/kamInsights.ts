// Pulso ABM → Inteligencia (KAM): insights del feedback del cliente y de
// Peitho, y temas para conversar con el cliente (pedido de BullsEye nov-2026).
//
// Fuentes (solo lectura):
//  - Encuesta de feedback de reuniones (`meeting_feedback`) + la planilla de
//    reuniones (`meetings`) del cliente y de sus registros con nombre
//    equivalente, últimos DAYS días.
//  - Peitho (si el cliente lo tiene activado): análisis de las reuniones
//    pasadas (resumen, dolores, objeciones, predicción, fit, próximos pasos),
//    sin transcripción ni video.
// La IA (herramienta forzada) devuelve insights con evidencia y temas de
// conversación con el cliente. Resultado y seguimiento de cada conversación
// (pendiente / conversado / descartado + nota) en allo_response_cache, sin
// migración: `kam_insights:v1:<client_id>`.
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { isPeithoEnabled } from "@/lib/peitho";
import { loadPeithoClient, peithoConfigured, peithoGetJson } from "@/lib/peithoIntegration";
import type { MeetingAnalysis, MeetingListItem } from "@/components/peitho/app/types";
import { normCompany } from "./sheetMeetings";

export const KAM_FUNCTION = "pulso_kam_insights";
const DAYS = 180;
const PEITHO_MAX = 25;          // reuniones de Peitho que se leen (las más recientes)
const CACHE_DAYS = 3650;        // el resultado queda hasta que se regenere
const cacheKey = (clientId: string) => `kam_insights:v1:${clientId}`;

export type KamSource = "feedback" | "peitho" | "ambos";
export type KamInsight = { id: string; titulo: string; hallazgo: string; evidencia: string; fuente: KamSource; tipo: "oportunidad" | "riesgo" | "icp" | "mensaje" | "proceso" };
export type KamConversation = {
  id: string;
  tema: string;
  por_que: string;
  pregunta: string;               // pregunta concreta para el cliente
  mensaje: string;                // mensaje sugerido (correo / WhatsApp)
  prioridad: "alta" | "media" | "baja";
  fuente: KamSource;
  estado: "pendiente" | "conversado" | "descartado";
  nota?: string;
  updated_by?: string;
  updated_at?: string;
};
export type KamInsightsDoc = {
  generated_at: string;
  generated_by: string;
  resumen: string;
  insights: KamInsight[];
  conversaciones: KamConversation[];
  sources: { feedback: number; peitho: number; peitho_status: string };
};

export async function loadKamInsights(clientId: string): Promise<KamInsightsDoc | null> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("response").eq("cache_key", cacheKey(clientId)).maybeSingle();
  return (data?.response as KamInsightsDoc | undefined) ?? null;
}

async function saveKamInsights(clientId: string, doc: KamInsightsDoc): Promise<void> {
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert({
    cache_key: cacheKey(clientId),
    response: doc,
    expires_at: new Date(Date.now() + CACHE_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`No se pudo guardar: ${error.message}`);
}

// ---------- Fuentes ----------

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function feedbackLines(clientId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data: allClients } = await db.from("clients").select("id, name");
  const compact = (s: string | null | undefined) => normCompany(s).replace(/ /g, "");
  const own = compact((allClients ?? []).find((c: any) => c.id === clientId)?.name);
  const ids = new Set<string>([clientId]);
  for (const c of allClients ?? []) {
    const k = compact(c.name);
    if (own.length >= 4 && k.length >= 4 && (k.startsWith(own) || own.startsWith(k))) ids.add(c.id);
  }
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: meetings } = await db.from("meetings")
    .select("id, empresa, contacto_cargo, fecha_reunion, realizado, propuesta_oportunidad, industria, pais")
    .in("client_id", [...ids]).gte("fecha_reunion", since).limit(3000);
  const byId = new Map((meetings ?? []).map((m: any) => [m.id, m]));
  const mids = [...byId.keys()];
  const out: string[] = [];
  for (let i = 0; i < mids.length; i += 300) {
    const { data } = await db.from("meeting_feedback")
      .select("meeting_id, calificacion, empresa_calificada, contacto_calificado, propuesta_comercial, comentarios_adicionales, probabilidad_cierre")
      .in("meeting_id", mids.slice(i, i + 300));
    for (const f of data ?? []) {
      const m: any = byId.get(f.meeting_id);
      out.push([
        `${m?.fecha_reunion ?? "?"} · ${clip(m?.empresa, 60)}${m?.industria ? ` (${clip(m.industria, 40)})` : ""}${m?.pais ? ` · ${m.pais}` : ""}`,
        m?.contacto_cargo ? `cargo: ${clip(m.contacto_cargo, 60)}` : "",
        f.calificacion != null ? `calificación ${f.calificacion}/10` : "",
        f.empresa_calificada != null ? `empresa ICP: ${f.empresa_calificada ? "sí" : "no"}` : "",
        f.contacto_calificado != null ? `contacto correcto: ${f.contacto_calificado ? "sí" : "no"}` : "",
        f.propuesta_comercial ? `propuesta: ${f.propuesta_comercial}` : "",
        f.probabilidad_cierre != null ? `prob. cierre ${f.probabilidad_cierre}%` : "",
        f.comentarios_adicionales?.trim() ? `comentario: "${clip(f.comentarios_adicionales, 400)}"` : "",
      ].filter(Boolean).join(" · "));
    }
  }
  return out.sort().reverse();
}

async function peithoLines(clientId: string): Promise<{ lines: string[]; status: string }> {
  const db = supabaseAdmin();
  if (!(await isPeithoEnabled(db, clientId))) return { lines: [], status: "no activado" };
  if (!peithoConfigured()) return { lines: [], status: "conexión no configurada" };
  const client = await loadPeithoClient(db, clientId);
  if (!client) return { lines: [], status: "cliente no encontrado" };
  try {
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    const list = (await peithoGetJson<MeetingListItem[]>(client, "/meetings?scope=past"))
      .filter((m) => m.status === "analyzed" && (!m.start_time || m.start_time >= since))
      .sort((a, b) => String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")))
      .slice(0, PEITHO_MAX);
    const lines: string[] = [];
    for (let i = 0; i < list.length; i += 5) {
      await Promise.all(list.slice(i, i + 5).map(async (m) => {
        try {
          const d = await peithoGetJson<{ analysis: MeetingAnalysis | null }>(client, `/meetings/${encodeURIComponent(m.id)}`);
          const a = d.analysis;
          if (!a || a.reunion_valida?.es_reunion_con_prospecto === false) return;
          const list = <T,>(xs: T[] | undefined, f: (x: T) => string, n = 4) => (xs ?? []).slice(0, n).map(f).filter(Boolean).join(" | ");
          lines.push([
            `${String(m.start_time ?? "").slice(0, 10)} · ${clip(m.empresa_nombre ?? m.empresa_contraparte, 60)}${m.contacto_cargo ? ` · ${clip(m.contacto_cargo, 60)}` : ""}`,
            a.apuntes_clave?.resumen_general ? `resumen: ${clip(a.apuntes_clave.resumen_general, 500)}` : "",
            a.prediccion_exito?.puntaje != null ? `predicción ${a.prediccion_exito.puntaje}/5 (${clip(a.prediccion_exito.etiqueta, 40)})` : "",
            a.fit_empresa?.puntaje != null ? `fit empresa ${a.fit_empresa.puntaje}` : "",
            (a.fit_cargo_contacto ?? a.fit_contacto)?.puntaje != null ? `fit cargo ${(a.fit_cargo_contacto ?? a.fit_contacto)!.puntaje}` : "",
            a.dolores_cliente?.length ? `dolores: ${list(a.dolores_cliente, (x) => clip(x.dolor, 140))}` : "",
            a.objeciones?.length ? `objeciones: ${list(a.objeciones, (x) => clip(`${x.tipo ?? ""}: ${x.contexto ?? ""}`, 160))}` : "",
            a.apuntes_clave?.acuerdos_proximos_pasos?.length ? `acuerdos: ${list(a.apuntes_clave.acuerdos_proximos_pasos, (x) => clip(x, 140))}` : "",
            a.temas_pendientes?.length ? `pendientes: ${list(a.temas_pendientes, (x) => clip(x.pregunta, 140), 3)}` : "",
          ].filter(Boolean).join(" · "));
        } catch { /* una reunión que falla no corta el resto */ }
      }));
    }
    return { lines: lines.sort().reverse(), status: list.length ? "ok" : "sin reuniones analizadas" };
  } catch (err) {
    return { lines: [], status: `error: ${clip((err as Error).message, 120)}` };
  }
}

// ---------- IA ----------

const TOOL: Anthropic.Tool = {
  name: "insights_kam",
  description: "Insights para el KAM y temas de conversación con el cliente",
  input_schema: {
    type: "object",
    properties: {
      resumen: { type: "string", description: "2–3 frases: qué dice el feedback y Peitho sobre cómo va la cuenta" },
      insights: {
        type: "array", maxItems: 8,
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            hallazgo: { type: "string", description: "Qué se observa y qué significa (1–2 frases)" },
            evidencia: { type: "string", description: "Datos concretos que lo sustentan: cuántas reuniones, empresas, citas cortas" },
            fuente: { type: "string", enum: ["feedback", "peitho", "ambos"] },
            tipo: { type: "string", enum: ["oportunidad", "riesgo", "icp", "mensaje", "proceso"] },
          },
          required: ["titulo", "hallazgo", "evidencia", "fuente", "tipo"],
        },
      },
      conversaciones: {
        type: "array", maxItems: 6,
        items: {
          type: "object",
          properties: {
            tema: { type: "string" },
            por_que: { type: "string", description: "Por qué conviene conversarlo ahora, con el dato" },
            pregunta: { type: "string", description: "Pregunta concreta y abierta para hacerle al cliente" },
            mensaje: { type: "string", description: "Mensaje breve listo para enviar al cliente (tono cercano y profesional, español, sin datos de contacto de prospectos)" },
            prioridad: { type: "string", enum: ["alta", "media", "baja"] },
            fuente: { type: "string", enum: ["feedback", "peitho", "ambos"] },
          },
          required: ["tema", "por_que", "pregunta", "mensaje", "prioridad", "fuente"],
        },
      },
    },
    required: ["resumen", "insights", "conversaciones"],
  },
};

const SYSTEM = `Eres el analista de cuentas (KAM) de BullsEye, agencia de prospección B2B que agenda reuniones para sus clientes.
Con el feedback que el cliente dejó de cada reunión y el análisis automático de Peitho (grabación de las reuniones), detecta patrones útiles para la relación con el cliente y propón conversaciones para tener con él: validar el ICP, entender por qué una reunión no avanzó, alinear el mensaje, pedir información, celebrar avances o ajustar el foco.
Reglas: usa solo lo que está en los datos; cita la evidencia (número de reuniones, empresas, frases cortas); un patrón necesita al menos 2 casos, si no, dilo como señal aislada; no inventes cifras; no incluyas correos ni teléfonos; escribe en español de Chile, claro y breve.`;

export async function generateKamInsights(clientId: string, by: string): Promise<KamInsightsDoc> {
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("name").eq("id", clientId).maybeSingle();
  const [fb, pe] = await Promise.all([feedbackLines(clientId), peithoLines(clientId)]);
  if (!fb.length && !pe.lines.length) {
    throw new Error(`No hay feedback del cliente ni reuniones analizadas en Peitho en los últimos ${DAYS} días (Peitho: ${pe.status}).`);
  }
  const user = `Cliente: ${client?.name ?? clientId}

<feedback_cliente total="${fb.length}">
${fb.slice(0, 120).join("\n") || "Sin feedback."}
</feedback_cliente>

<peitho total="${pe.lines.length}">
${pe.lines.join("\n") || `Sin datos (${pe.status}).`}
</peitho>

Usa la herramienta insights_kam.`;
  const model = CLAUDE_MODEL;
  const msg = await anthropic().messages.create({
    model,
    max_tokens: 3500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: user }],
  });
  void logAiUsage({ clientId, functionName: KAM_FUNCTION, model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, metadata: { feedback: fb.length, peitho: pe.lines.length } });
  const block = msg.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error("La IA no devolvió los insights");
  const r = block.input as { resumen?: string; insights?: any[]; conversaciones?: any[] };
  const src = (s: unknown): KamSource => (s === "feedback" || s === "peitho" ? s : "ambos");

  // Las conversaciones ya marcadas (mismo tema) conservan su estado y nota
  const prev = await loadKamInsights(clientId);
  const prevByTema = new Map((prev?.conversaciones ?? []).filter((c) => c.estado !== "pendiente").map((c) => [c.tema.trim().toLowerCase(), c]));
  const stamp = Date.now().toString(36);
  const doc: KamInsightsDoc = {
    generated_at: new Date().toISOString(),
    generated_by: by,
    resumen: String(r.resumen ?? ""),
    insights: (r.insights ?? []).slice(0, 8).map((x, i) => ({
      id: `i${i + 1}`, titulo: String(x.titulo ?? ""), hallazgo: String(x.hallazgo ?? ""), evidencia: String(x.evidencia ?? ""),
      fuente: src(x.fuente), tipo: (["oportunidad", "riesgo", "icp", "mensaje", "proceso"].includes(x.tipo) ? x.tipo : "proceso") as KamInsight["tipo"],
    })),
    conversaciones: [
      // Las ya conversadas o descartadas quedan como historial
      ...(prev?.conversaciones ?? []).filter((c) => c.estado !== "pendiente"),
      ...(r.conversaciones ?? []).slice(0, 6)
        .filter((x) => !prevByTema.has(String(x.tema ?? "").trim().toLowerCase()))
        .map((x, i) => ({
          id: `c${stamp}${i}`, tema: String(x.tema ?? ""), por_que: String(x.por_que ?? ""), pregunta: String(x.pregunta ?? ""), mensaje: String(x.mensaje ?? ""),
          prioridad: (["alta", "media", "baja"].includes(x.prioridad) ? x.prioridad : "media") as KamConversation["prioridad"],
          fuente: src(x.fuente), estado: "pendiente" as const,
        })),
    ],
    sources: { feedback: fb.length, peitho: pe.lines.length, peitho_status: pe.status },
  };
  await saveKamInsights(clientId, doc);
  return doc;
}

export async function updateKamConversation(
  clientId: string, id: string, patch: { estado?: KamConversation["estado"]; nota?: string }, by: string
): Promise<KamInsightsDoc> {
  const doc = await loadKamInsights(clientId);
  if (!doc) throw new Error("Todavía no hay insights para este cliente");
  const c = doc.conversaciones.find((x) => x.id === id);
  if (!c) throw new Error("Conversación no encontrada");
  if (patch.estado && ["pendiente", "conversado", "descartado"].includes(patch.estado)) c.estado = patch.estado;
  if (patch.nota !== undefined) c.nota = String(patch.nota).trim().slice(0, 1000);
  c.updated_by = by;
  c.updated_at = new Date().toISOString();
  await saveKamInsights(clientId, doc);
  return doc;
}
