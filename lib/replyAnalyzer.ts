// Clasificador de respuestas (replies) de la cadencia de Lemlist con Claude.
// Sprint 6 fase 2 — módulo /respuestas.
//
// Toma el texto de una respuesta (de email o LinkedIn) y devuelve:
//   - category: clasificación estable (para agregar y filtrar)
//   - sentiment: positive / neutral / negative
//   - summary: 1 frase en español
//   - suggested_next_step: acción concreta para el SDR
//
// Output en español rioplatense. Las keys de category quedan en inglés/
// snake_case porque las usamos para filtrar y agregar.

import { createMessageWithFallback } from "./claude";

export type ReplyCategory =
  | "interested"
  | "meeting_request"
  | "referral"
  | "objection"
  | "not_interested"
  | "unsubscribe"
  | "auto_reply"
  | "question"
  | "other";

export type ReplySentiment = "positive" | "neutral" | "negative";

export const REPLY_CATEGORY_LABELS: Record<ReplyCategory, string> = {
  interested: "Interesado",
  meeting_request: "Pide reunión",
  referral: "Deriva a otra persona",
  objection: "Objeción",
  not_interested: "No interesado",
  unsubscribe: "Pide baja",
  auto_reply: "Respuesta automática",
  question: "Pregunta",
  other: "Otro"
};

// Categorías que son señal de avance del pipeline (para KPIs).
export const POSITIVE_REPLY_CATEGORIES: ReadonlySet<ReplyCategory> = new Set([
  "interested",
  "meeting_request",
  "referral"
]);

const VALID_CATEGORIES = new Set<string>(Object.keys(REPLY_CATEGORY_LABELS));
const VALID_SENTIMENTS = new Set<string>(["positive", "neutral", "negative"]);

export type ReplyAnalysisInput = {
  channel: string | null; // 'email' | 'linkedin' | ...
  reply_text: string;
  contact_name: string | null;
  job_title: string | null;
  company_name: string | null;
};

export type ReplyAnalysis = {
  category: ReplyCategory;
  sentiment: ReplySentiment;
  summary: string;
  suggested_next_step: string;
  model_used: string;
};

const SYSTEM_PROMPT = `Eres analista de respuestas de outbound para weCAD4you, un servicio B2B que diseña restauraciones dentales CAD/CAM (coronas, puentes, carillas) en exocad e inLab con entrega en 24h (6h rush). Los prospectos son laboratorios dentales, grupos multi-clínica y DSOs.

El SDR le escribió a un prospecto por LinkedIn o email y el prospecto RESPONDIÓ. Tu trabajo es clasificar esa respuesta para que el SDR sepa qué hacer.

Sé honesto y directo. "Interesado" es solo cuando hay intención real de avanzar, no cortesía. Una respuesta automática de fuera-de-oficina es auto_reply, no interés.

Responde SIEMPRE en español rioplatense. Devuelve JSON estricto, sin prosa ni fences alrededor.`;

function buildUserPrompt(input: ReplyAnalysisInput): string {
  const lines: string[] = [];
  lines.push(`CONTEXTO DEL PROSPECTO:`);
  lines.push(`- Nombre: ${input.contact_name ?? "(desconocido)"}`);
  lines.push(`- Cargo: ${input.job_title ?? "(desconocido)"}`);
  lines.push(`- Empresa: ${input.company_name ?? "(desconocida)"}`);
  lines.push(`- Canal de la respuesta: ${input.channel ?? "(desconocido)"}`);
  lines.push(``);
  lines.push(`TEXTO DE LA RESPUESTA DEL PROSPECTO:`);
  lines.push(input.reply_text.trim().slice(0, 6000));
  lines.push(``);
  lines.push(`Devolvé este JSON exacto (sin texto extra ni fences):`);
  lines.push(`{`);
  lines.push(
    `  "category": "<una de: interested | meeting_request | referral | objection | not_interested | unsubscribe | auto_reply | question | other>",`
  );
  lines.push(`  "sentiment": "<positive | neutral | negative>",`);
  lines.push(`  "summary": "<1 frase en español: qué dijo el prospecto>",`);
  lines.push(
    `  "suggested_next_step": "<acción concreta para el SDR: agendar call, mandar caso de estudio, sacar de la campaña, responder la pregunta X, etc.>"`
  );
  lines.push(`}`);
  lines.push(``);
  lines.push(`Reglas:`);
  lines.push(`- meeting_request: pide explícitamente una llamada/reunión/demo.`);
  lines.push(`- referral: te manda a hablar con otra persona del equipo.`);
  lines.push(
    `- objection: responde con una traba concreta (precio, ya tienen solución, no es momento, no es su área pero sin derivar).`
  );
  lines.push(`- unsubscribe: pide explícitamente que no lo contacten más.`);
  lines.push(`- auto_reply: out-of-office, vacaciones, respuesta automática.`);
  lines.push(`- question: hace una pregunta puntual sin mostrar interés claro de avanzar.`);
  lines.push(`- suggested_next_step: una sola acción concreta, no una lista.`);
  return lines.join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(body);
}

export async function analyzeReply(input: ReplyAnalysisInput): Promise<ReplyAnalysis> {
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }]
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude no devolvió texto");
  }
  const parsed = extractJson(textBlock.text) as Record<string, unknown>;

  const rawCategory = String(parsed.category ?? "").trim();
  const category: ReplyCategory = VALID_CATEGORIES.has(rawCategory)
    ? (rawCategory as ReplyCategory)
    : "other";

  const rawSentiment = String(parsed.sentiment ?? "").trim();
  const sentiment: ReplySentiment = VALID_SENTIMENTS.has(rawSentiment)
    ? (rawSentiment as ReplySentiment)
    : "neutral";

  const summary = String(parsed.summary ?? "").trim() || "(sin resumen)";
  const suggested_next_step =
    String(parsed.suggested_next_step ?? "").trim() || "(sin sugerencia)";

  return { category, sentiment, summary, suggested_next_step, model_used };
}
