// Lógica de scoring de contactos: determina si un contacto debe ser auto-promovido
// basándose en su fit_score, fit y fit_action y las keywords de la config del modelo.
import { anthropic, CLAUDE_MODEL } from "./claude";

export type ScoringDecision = "auto_approve" | "manual_review" | "discard" | "none";

export type ContactScoringInput = {
  fit_score: number | null;
  fit: string | null;
  fit_action: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  strong_decision_maker_keywords?: string[];
};

/**
 * Evalúa si un contacto scored debe ser auto-aprobado, mandado a revisión manual,
 * descartado, o si no hay acción (ya fue procesado o no tiene datos suficientes).
 */
export function evaluateScoringDecision(
  input: ContactScoringInput
): ScoringDecision {
  const { fit_score, fit, fit_action } = input;

  // Si ya tiene una acción explícita de Clay, respetarla
  if (fit_action === "discard") return "discard";

  // fit_action enrich con score alto → auto-aprobar
  if (fit_action === "enrich" && fit_score !== null && fit_score >= 7) {
    return "auto_approve";
  }

  // fit high con score alto → auto-aprobar
  if (fit === "high" && fit_score !== null && fit_score >= 8) {
    return "auto_approve";
  }

  // fit_action manual_review o fit medium → revisión manual
  if (fit_action === "manual_review" || fit === "medium") {
    return "manual_review";
  }

  // fit low sin acción explícita → descartar
  if (fit === "low") return "discard";

  // Sin datos suficientes
  return "none";
}

/**
 * Verifica si el job_title o headline contienen keywords de decisor fuerte.
 */
export function isStrongDecisionMaker(
  jobTitle: string | null | undefined,
  headline: string | null | undefined,
  keywords: string[]
): boolean {
  if (!keywords.length) return false;
  const text = `${jobTitle ?? ""} ${headline ?? ""}`.toLowerCase();
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

export type ScoreInput = {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  seniority: string | null;
  company_name: string | null;
  company_type: string | null;
  company_size: number | null;
  tool_primary: string | null;
  tool_secondary: string | null;
  fit_signals: string | null;
};

export type ScoreResult = {
  fit_score: number;
  fit_reason: string;
  fit: string;
};

/**
 * Calcula el fit score de un contacto usando Claude.
 * Usado como fallback cuando el contacto no tiene score (ej: importado manualmente).
 */
export async function computeContactFitScore(input: ScoreInput): Promise<ScoreResult> {
  const prompt = `Evalúa el fit de este contacto B2B del 1 al 10.

Contacto:
- Nombre: ${input.first_name ?? ""} ${input.last_name ?? ""}
- Cargo: ${input.job_title ?? "(desconocido)"}
- Headline LinkedIn: ${input.linkedin_headline ?? "(sin datos)"}
- Seniority: ${input.seniority ?? "(desconocido)"}

Empresa:
- Nombre: ${input.company_name ?? "(desconocido)"}
- Tipo: ${input.company_type ?? "(desconocido)"}
- Tamaño: ${input.company_size != null ? `${input.company_size} empleados` : "(desconocido)"}
- Tooling primario: ${input.tool_primary ?? "(sin datos)"}
- Tooling secundario: ${input.tool_secondary ?? "(sin datos)"}
- Señales de fit: ${input.fit_signals ?? "(ninguna)"}

Responde únicamente con JSON: {"fit_score": <1-10>, "fit": "high"|"medium"|"low", "fit_reason": "<explicación breve>"}`;

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }]
  });

  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude no retornó texto");

  const raw = block.text.trim().match(/\{[\s\S]*\}/);
  if (!raw) throw new Error("No se pudo parsear la respuesta de scoring");

  const parsed = JSON.parse(raw[0]) as { fit_score?: number; fit?: string; fit_reason?: string };
  return {
    fit_score: typeof parsed.fit_score === "number" ? Math.max(1, Math.min(10, Math.round(parsed.fit_score))) : 5,
    fit: parsed.fit ?? "medium",
    fit_reason: parsed.fit_reason ?? ""
  };
}
