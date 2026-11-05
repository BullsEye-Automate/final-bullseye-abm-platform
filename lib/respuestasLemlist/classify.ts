import { anthropic, HAIKU_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";

// Respuestas Lemlist → SDR: clasificación del interés con Claude.

export const CATEGORIES = ["interesado", "referido", "tibio", "no_interesado", "fuera_oficina", "baja"] as const;
export type Category = (typeof CATEGORIES)[number] | "sin_texto";

export const CATEGORY_LABEL: Record<Category, string> = {
  interesado: "Interesado",
  referido: "Referido",
  tibio: "Tibio / más adelante",
  no_interesado: "No interesado",
  fuera_oficina: "Fuera de oficina",
  baja: "Baja / no contactar",
  sin_texto: "Sin texto",
};

// Categorías que se asignan al SDR (acordado con BullsEye)
export const ASSIGN_CATEGORIES: Category[] = ["interesado", "referido", "tibio"];
// Bajo esta confianza la respuesta va a revisión del KAM
export const MIN_CONFIDENCE = 0.6;

export type Classification = { category: Category; confidence: number; summary: string };

const SYSTEM = `Clasificas respuestas de prospectos B2B a campañas de prospección (email o LinkedIn) de una agencia que agenda reuniones para sus clientes.
Categorías:
- interesado: quiere reunión, llamada, demo, propuesta o más información; pregunta precio o detalles con intención.
- referido: deriva a otra persona ("habla con X", "te copio a Y") o da otro contacto.
- tibio: no ahora pero deja la puerta abierta ("escríbeme en marzo", "estamos en otro proyecto, más adelante").
- no_interesado: rechaza sin pedir que no lo contacten más ("no nos interesa", "ya tenemos proveedor").
- fuera_oficina: respuesta automática (vacaciones, licencia, ya no trabaja aquí sin derivar).
- baja: pide no ser contactado, darse de baja o borrar sus datos.
Responde SOLO un JSON: {"category": "...", "confidence": 0.0-1.0, "summary": "una línea en español con lo que dijo"}`;

export async function classifyReply(text: string, ctx: { clientId: string; clientName: string }): Promise<Classification> {
  const clean = (text ?? "").trim();
  if (!clean) return { category: "sin_texto", confidence: 0, summary: "Lemlist no entregó el texto de la respuesta." };
  const msg = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: `Cliente que prospecta: ${ctx.clientName}\n\nRespuesta del prospecto:\n"""\n${clean.slice(0, 3000)}\n"""` }],
  });
  void logAiUsage({ clientId: ctx.clientId, functionName: "lemlist_reply_classify", model: HAIKU_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  const raw = (msg.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  try {
    const p = JSON.parse(json ?? "{}") as { category?: string; confidence?: number; summary?: string };
    const category = (CATEGORIES as readonly string[]).includes(p.category ?? "") ? (p.category as Category) : null;
    if (!category) return { category: "tibio", confidence: 0, summary: `No se pudo clasificar: ${raw.slice(0, 120)}` };
    return { category, confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)), summary: (p.summary ?? "").slice(0, 300) };
  } catch {
    return { category: "tibio", confidence: 0, summary: `No se pudo clasificar: ${raw.slice(0, 120)}` };
  }
}
