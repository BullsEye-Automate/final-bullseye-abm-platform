// Lógica de scoring de contactos: determina si un contacto debe ser auto-promovido
// basándose en su fit_score, fit y fit_action y las keywords de la config del modelo.

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
