import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./claude";
import { logAiUsage } from "./aiUsageLogger";

// ─── Tipos ──────────────────────────────────────────────────────────────────

// Las 8 categorías del prompt original de análisis comercial — fijas (enum)
// en vez de texto libre para que el filtro "tipo de señal" en /sdr/senales
// sea confiable (texto libre generaba variantes inconsistentes entre
// llamadas, ej. "Ciclo de presupuesto" vs "Presupuesto anual").
export type CallSignalCategory =
  | "ciclo_presupuesto"
  | "evaluacion_proveedores"
  | "contrato_vigente"
  | "licitacion_compras"
  | "proyecto_postergado"
  | "necesidad_futura"
  | "cambio_organizacional"
  | "rechazo_definitivo";

export const CALL_SIGNAL_CATEGORIES: { value: CallSignalCategory; label: string }[] = [
  { value: "ciclo_presupuesto", label: "Ciclo de presupuesto" },
  { value: "evaluacion_proveedores", label: "Evaluación de proveedores" },
  { value: "contrato_vigente", label: "Contrato vigente / renovación" },
  { value: "licitacion_compras", label: "Licitación / proceso de compras" },
  { value: "proyecto_postergado", label: "Proyecto postergado" },
  { value: "necesidad_futura", label: "Necesidad futura" },
  { value: "cambio_organizacional", label: "Cambio organizacional" },
  { value: "rechazo_definitivo", label: "Rechazo definitivo" },
];

export type CallSignal = {
  categoria: CallSignalCategory;
  evidencia: string;
  tipo_senal: "restriccion_temporal" | "oportunidad_futura" | "proceso_compra" | "rechazo_definitivo" | "informacion_contextual";
  periodo: string;
  certeza: "explicito" | "inferido" | "insuficiente";
  relevancia: "alta" | "media" | "baja";
  relevancia_motivo: string;
};

export type MentionedCompany = {
  nombre: string;
  contexto: string;
  tipo: "competidor" | "referido" | "proveedor_actual" | "otro";
};

export type MentionedTechnology = {
  nombre: string;
  contexto: string;
};

export type CallSignalsResult = {
  empresa_prospecto: string;
  industria_prospecto: string;
  senales: CallSignal[];
  empresas_mencionadas: MentionedCompany[];
  tecnologias_mencionadas: MentionedTechnology[];
  accion_sugerida: "seguimiento_fecha" | "seguimiento_condicionado" | "investigacion_adicional" | "cambio_interlocutor" | "descalificacion" | "ninguna_accion";
  fecha_seguimiento: string;
  resumen_crm: string;
};

// ─── Prompt y schema ────────────────────────────────────────────────────────
// Basado en el prompt de análisis comercial validado manualmente contra
// transcripts reales de Crossnet antes de automatizar (ver conversación de
// diseño) — reglas obligatorias preservadas tal cual para evitar que el
// modelo invente fechas, presupuestos o nombres de empresas.

const SYSTEM_PROMPT = `Actúa como analista de inteligencia comercial B2B especializado en prospección outbound y Account-Based Marketing.

Analiza la transcripción de una llamada entre un SDR y un prospecto. Tu objetivo es identificar información comercial que permita comprender el momento de compra de la empresa, sus restricciones, procesos internos y posibles oportunidades futuras — para un negocio de agencia de prospección B2B que gestiona esta cuenta en nombre de uno de sus clientes.

1. Identificación de señales — clasifica cada señal detectada en UNA de estas 8 categorías fijas:
- ciclo_presupuesto: ciclos de presupuesto y planificación financiera.
- evaluacion_proveedores: periodos de evaluación, incorporación o suspensión de proveedores.
- contrato_vigente: contratos vigentes y fechas de renovación.
- licitacion_compras: licitaciones, homologaciones y procesos de compras.
- proyecto_postergado: proyectos postergados, suspendidos o planificados.
- necesidad_futura: necesidades comerciales futuras.
- cambio_organizacional: cambios de prioridades, responsables o estructura organizacional.
- rechazo_definitivo: rechazos definitivos y ausencia real de necesidad.

2. Empresas mencionadas — detecta si el prospecto (o el SDR citando al prospecto) nombra OTRA empresa en la conversación: un competidor que ya usan, un proveedor con el que están cotizando, o un referido al que deberían contactar. Solo regístralas si el nombre aparece explícitamente en la transcripción.

3. Tecnologías mencionadas — detecta si el prospecto nombra explícitamente alguna herramienta, plataforma, sistema o software que usan actualmente (ej. "usamos Salesforce", "tenemos un sistema propio de tickets"). Solo regístralas si se nombran explícitamente, no infieras stack tecnológico.

4. Industria del prospecto — si es posible inferir razonablemente el rubro/industria de la empresa del prospecto a partir de lo dicho en la llamada (nombre de la empresa, lo que describe que hacen, su cargo), indícalo en una palabra o frase corta (ej. "Retail", "Salud", "Logística", "Tecnología", "Servicios financieros"). String vacío si no hay base para inferirlo.

5. Reglas obligatorias:
- No inventes fechas, presupuestos, necesidades, intenciones, nombres de empresas ni tecnologías que no estén explícitamente en la transcripción.
- No interpretes automáticamente "no interesado" como falta de fit.
- Distingue entre una política permanente y una restricción temporal.
- No confundas una objeción utilizada para terminar la llamada con una oportunidad validada.
- No confundas una respuesta cortés de salida rápida (ej. "mándame un correo" sin ningún otro contenido sustantivo) con una señal de interés real — en ese caso, no hay evidencia suficiente para registrar una señal.
- Si una misma llamada contiene varias señales, regístralas por separado, incluso si caen en la misma categoría.
- Para fecha_seguimiento: solo complétala si el prospecto ACEPTÓ explícitamente una fecha concreta. Si el SDR propuso una fecha pero el prospecto solo respondió de forma tentativa ("podría ser", "veremos"), NO la registres como fecha confirmada — usa accion_sugerida "seguimiento_condicionado" en vez de "seguimiento_fecha".
- Si no hay evidencia suficiente para ninguna señal, entrega un array de señales vacío — no fuerces una clasificación.

Usa la herramienta extraer_senales_comerciales para entregar tu análisis. En todos los campos de texto que sean opcionales, si no aplica entrega un string vacío "" en vez de omitir el campo.`;

const CATEGORY_VALUES = CALL_SIGNAL_CATEGORIES.map((c) => c.value);

const TOOL: Anthropic.Tool = {
  name: "extraer_senales_comerciales",
  description: "Extrae señales de inteligencia comercial B2B de una transcripción de llamada SDR-prospecto",
  input_schema: {
    type: "object",
    properties: {
      empresa_prospecto: {
        type: "string",
        description: "Nombre de la empresa del prospecto, si se menciona explícitamente en la llamada. String vacío si no se menciona.",
      },
      industria_prospecto: {
        type: "string",
        description: "Industria/rubro del prospecto inferido razonablemente (ej. 'Retail', 'Salud', 'Logística'). String vacío si no hay base para inferirlo.",
      },
      senales: {
        type: "array",
        description: "Señales comerciales detectadas, una por hallazgo. Array vacío si no hay evidencia suficiente.",
        items: {
          type: "object",
          properties: {
            categoria: {
              type: "string",
              enum: CATEGORY_VALUES,
              description: "Una de las 8 categorías fijas definidas en las instrucciones",
            },
            evidencia: { type: "string", description: "Frase textual del prospecto que respalda la clasificación" },
            tipo_senal: {
              type: "string",
              enum: ["restriccion_temporal", "oportunidad_futura", "proceso_compra", "rechazo_definitivo", "informacion_contextual"],
            },
            periodo: { type: "string", description: "Fecha o periodo mencionado, si existe explícitamente. String vacío si no aplica." },
            certeza: { type: "string", enum: ["explicito", "inferido", "insuficiente"] },
            relevancia: { type: "string", enum: ["alta", "media", "baja"] },
            relevancia_motivo: { type: "string", description: "Por qué esa relevancia, en una frase" },
          },
          required: ["categoria", "evidencia", "tipo_senal", "periodo", "certeza", "relevancia", "relevancia_motivo"],
        },
      },
      empresas_mencionadas: {
        type: "array",
        description: "Otras empresas nombradas explícitamente en la conversación. Array vacío si no se menciona ninguna.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre de la empresa tal como se menciona" },
            contexto: { type: "string", description: "Frase o contexto en que se menciona" },
            tipo: { type: "string", enum: ["competidor", "referido", "proveedor_actual", "otro"] },
          },
          required: ["nombre", "contexto", "tipo"],
        },
      },
      tecnologias_mencionadas: {
        type: "array",
        description: "Herramientas, plataformas o sistemas que el prospecto dice usar actualmente, nombrados explícitamente. Array vacío si no se menciona ninguna.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre de la herramienta/plataforma tal como se menciona" },
            contexto: { type: "string", description: "Frase o contexto en que se menciona" },
          },
          required: ["nombre", "contexto"],
        },
      },
      accion_sugerida: {
        type: "string",
        enum: ["seguimiento_fecha", "seguimiento_condicionado", "investigacion_adicional", "cambio_interlocutor", "descalificacion", "ninguna_accion"],
        description: "Acción recomendada según la evidencia disponible",
      },
      fecha_seguimiento: {
        type: "string",
        description: "Fecha de seguimiento en formato YYYY-MM-DD, solo si fue explícitamente aceptada por el prospecto en la llamada. String vacío si no hay fecha confirmada.",
      },
      resumen_crm: {
        type: "string",
        description: "Resumen de máximo 3 líneas para registrar en el CRM",
      },
    },
    required: [
      "empresa_prospecto",
      "industria_prospecto",
      "senales",
      "empresas_mencionadas",
      "tecnologias_mencionadas",
      "accion_sugerida",
      "fecha_seguimiento",
      "resumen_crm",
    ],
  },
};

// ─── Análisis ───────────────────────────────────────────────────────────────

export async function analyzeCallTranscript(
  transcript: string,
  icpContext: string,
  model: string,
  clientId?: string,
  userId?: string | null
): Promise<CallSignalsResult> {
  const userPrompt = `Contexto del ICP / propuesta de valor del cliente que está prospectando (úsalo para evaluar si el prospecto encaja con lo que vende, pero las señales deben basarse en la transcripción, nunca inventarse desde el ICP):

${icpContext || "No disponible"}

Transcripción de la llamada (SDR = "SDR", prospecto = "Contacto"):

${transcript}

Analiza la llamada usando la herramienta extraer_senales_comerciales.`;

  const message = await anthropic().messages.create({
    model,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "extraer_senales_comerciales" },
    messages: [{ role: "user", content: userPrompt }],
  });

  void logAiUsage({
    userId,
    clientId,
    functionName: "allo_call_signal_analysis",
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Claude no usó la herramienta extraer_senales_comerciales");
  }

  const input = toolUse.input as Record<string, unknown>;
  return {
    empresa_prospecto: typeof input.empresa_prospecto === "string" ? input.empresa_prospecto : "",
    industria_prospecto: typeof input.industria_prospecto === "string" ? input.industria_prospecto : "",
    senales: Array.isArray(input.senales) ? (input.senales as CallSignal[]) : [],
    empresas_mencionadas: Array.isArray(input.empresas_mencionadas) ? (input.empresas_mencionadas as MentionedCompany[]) : [],
    tecnologias_mencionadas: Array.isArray(input.tecnologias_mencionadas) ? (input.tecnologias_mencionadas as MentionedTechnology[]) : [],
    accion_sugerida: (input.accion_sugerida as CallSignalsResult["accion_sugerida"]) ?? "ninguna_accion",
    fecha_seguimiento: typeof input.fecha_seguimiento === "string" ? input.fecha_seguimiento : "",
    resumen_crm: typeof input.resumen_crm === "string" ? input.resumen_crm : "",
  };
}

// Relevancia máxima entre las señales detectadas — determina el orden en la
// bandeja de señales. null si no hay ninguna señal (nada que mostrar).
export function topRelevance(senales: CallSignal[]): "alta" | "media" | "baja" | null {
  if (senales.some((s) => s.relevancia === "alta")) return "alta";
  if (senales.some((s) => s.relevancia === "media")) return "media";
  if (senales.some((s) => s.relevancia === "baja")) return "baja";
  return null;
}
