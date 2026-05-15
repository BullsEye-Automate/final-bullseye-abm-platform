// Carga y aplicación de la configuración del modelo de mensajes (de
// model_training_config). Compartido entre el endpoint /api/model-training
// y messageGenerator.
//
// Principio rector: si la config no existe o el campo está vacío,
// messageGenerator se comporta EXACTAMENTE como antes. Solo cuando hay
// un valor lo aplica.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TalkingPoint = {
  /**
   * Rol del prospecto. Match laxo case-insensitive contra job_title.
   * "any" o "*" funciona como fallback para cualquier rol.
   */
  role: string;
  /**
   * Tipo de empresa. "lab" | "multi_clinic" | "dso" | "any".
   * "any" matchea cualquier tipo.
   */
  company_type: string;
  /**
   * Guidelines en texto libre. Se inyecta como bullet al system prompt
   * cuando matchea con el contacto.
   */
  points: string;
};

export type ModelTrainingConfig = {
  id: string;
  is_active: boolean;
  language: string | null;
  register: string | null;
  icebreaker_max_chars: number | null;
  subject_max_words: number | null;
  body_max_words: number | null;
  forbidden_phrases: string[];
  required_phrases: string[];
  talking_points: TalkingPoint[];
  value_props: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Carga la config activa. Si no hay fila o todos los campos están vacíos,
 * devuelve null y el caller usa los defaults hardcodeados.
 */
export async function loadActiveModelTrainingConfig(
  db: SupabaseClient
): Promise<ModelTrainingConfig | null> {
  const { data, error } = await db
    .from("model_training_config")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeConfig(data);
}

function normalizeConfig(raw: any): ModelTrainingConfig {
  return {
    id: raw.id,
    is_active: !!raw.is_active,
    language: raw.language ?? null,
    register: raw.register ?? null,
    icebreaker_max_chars:
      typeof raw.icebreaker_max_chars === "number" ? raw.icebreaker_max_chars : null,
    subject_max_words:
      typeof raw.subject_max_words === "number" ? raw.subject_max_words : null,
    body_max_words:
      typeof raw.body_max_words === "number" ? raw.body_max_words : null,
    forbidden_phrases: Array.isArray(raw.forbidden_phrases)
      ? raw.forbidden_phrases.filter((s: unknown) => typeof s === "string" && s.trim())
      : [],
    required_phrases: Array.isArray(raw.required_phrases)
      ? raw.required_phrases.filter((s: unknown) => typeof s === "string" && s.trim())
      : [],
    talking_points: Array.isArray(raw.talking_points)
      ? raw.talking_points
          .filter(
            (t: any) =>
              t &&
              typeof t.role === "string" &&
              typeof t.company_type === "string" &&
              typeof t.points === "string" &&
              t.points.trim()
          )
          .map((t: any) => ({
            role: t.role.trim(),
            company_type: t.company_type.trim(),
            points: t.points.trim()
          }))
      : [],
    value_props: Array.isArray(raw.value_props)
      ? raw.value_props.filter((s: unknown) => typeof s === "string" && s.trim())
      : [],
    notes: raw.notes && typeof raw.notes === "string" && raw.notes.trim() ? raw.notes : null,
    created_at: raw.created_at,
    updated_at: raw.updated_at
  };
}

/**
 * ¿La config tiene contenido relevante? Si está totalmente vacía, el
 * caller puede saltearla y usar los defaults hardcodeados (sin tocar
 * el prompt).
 */
export function configHasContent(c: ModelTrainingConfig | null): boolean {
  if (!c) return false;
  return (
    !!c.language ||
    !!c.register ||
    c.icebreaker_max_chars != null ||
    c.subject_max_words != null ||
    c.body_max_words != null ||
    c.forbidden_phrases.length > 0 ||
    c.required_phrases.length > 0 ||
    c.talking_points.length > 0 ||
    c.value_props.length > 0 ||
    !!c.notes
  );
}

/**
 * Match laxo de talking points. Busca puntos que aplican al contacto
 * por (role × company_type). Cada criterio puede ser "any"/"*" como wildcard.
 *
 * Strategy:
 *   - Match exacto de role + tipo → mejor prioridad.
 *   - Role exacto + tipo any → fallback.
 *   - Role any + tipo exacto → fallback.
 *   - Role any + tipo any → fallback general.
 * Devuelve TODOS los puntos relevantes, ordenados por especificidad.
 */
export function matchTalkingPoints(
  config: ModelTrainingConfig,
  jobTitle: string | null,
  companyType: string | null
): string[] {
  const jt = (jobTitle ?? "").toLowerCase();
  const ct = (companyType ?? "").toLowerCase();
  const isAny = (s: string) => {
    const v = s.toLowerCase().trim();
    return v === "any" || v === "*" || v === "";
  };
  const roleMatches = (role: string): boolean => {
    if (isAny(role)) return true;
    return jt.includes(role.toLowerCase().trim());
  };
  const typeMatches = (companyType: string): boolean => {
    if (isAny(companyType)) return true;
    return ct === companyType.toLowerCase().trim();
  };

  const scored = config.talking_points
    .filter((tp) => roleMatches(tp.role) && typeMatches(tp.company_type))
    .map((tp) => {
      let specificity = 0;
      if (!isAny(tp.role)) specificity += 2;
      if (!isAny(tp.company_type)) specificity += 1;
      return { tp, specificity };
    })
    .sort((a, b) => b.specificity - a.specificity);

  return scored.map((s) => s.tp.points);
}

/**
 * Construye un bloque de texto con las reglas del config para inyectar
 * al prompt de Claude. Si la config está vacía, devuelve "" y el prompt
 * queda como antes.
 */
export function renderConfigInstructions(
  config: ModelTrainingConfig | null,
  jobTitle: string | null,
  companyType: string | null
): string {
  if (!configHasContent(config)) return "";
  const c = config!;
  const lines: string[] = [];
  lines.push("");
  lines.push("CUSTOM TRAINING CONFIG (provided by the team):");
  if (c.language) {
    const langLabel =
      c.language === "es"
        ? "Spanish (Latin American)"
        : c.language === "mix"
        ? "Mix English/Spanish (default English, adapt naturally if the prospect's profile suggests Spanish-speaking)"
        : "English";
    lines.push(`- Language: ${langLabel}.`);
  }
  if (c.register) {
    const regLabel =
      c.register === "formal"
        ? "Formal, respectful (for senior executives, DSOs, C-level)"
        : c.register === "casual"
        ? "Casual, conversational (peer-to-peer, no corporate buzzwords)"
        : c.register === "peer_industry"
        ? "Dental industry peer (use jargon naturally, assume domain knowledge)"
        : c.register;
    lines.push(`- Register / tone: ${regLabel}.`);
  }
  if (c.icebreaker_max_chars != null) {
    lines.push(`- Icebreaker max chars: ${c.icebreaker_max_chars} (override default of 180).`);
  }
  if (c.subject_max_words != null) {
    lines.push(`- Email subject max words: ${c.subject_max_words} (override default of 7).`);
  }
  if (c.body_max_words != null) {
    lines.push(`- Email body max words: ${c.body_max_words}.`);
  }
  if (c.forbidden_phrases.length > 0) {
    lines.push(
      `- FORBIDDEN phrases (NEVER use): ${c.forbidden_phrases.map((p) => `"${p}"`).join(", ")}.`
    );
  }
  if (c.required_phrases.length > 0) {
    lines.push(
      `- Preferred phrasing (use these when relevant, paraphrase if needed): ${c.required_phrases.map((p) => `"${p}"`).join(", ")}.`
    );
  }
  if (c.value_props.length > 0) {
    lines.push(`- Value propositions of weCAD4you, in priority order:`);
    c.value_props.forEach((v, i) => lines.push(`  ${i + 1}. ${v}`));
    lines.push(
      `  When choosing which to mention, prefer the ones earlier in the list.`
    );
  }
  // Talking points específicos del contacto
  const tps = matchTalkingPoints(c, jobTitle, companyType);
  if (tps.length > 0) {
    lines.push(`- Specific talking points for this prospect's role × company type:`);
    tps.forEach((tp) => lines.push(`  - ${tp}`));
  }
  if (c.notes) {
    lines.push(`- Additional team notes: ${c.notes}`);
  }
  return lines.join("\n");
}
