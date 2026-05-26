// Carga y caché de la configuración de entrenamiento del modelo de scoring.
import type { SupabaseClient } from "@supabase/supabase-js";

// Carga el contenido del ICP de un cliente desde client_ai_context.
export async function loadClientIcpContext(
  db: SupabaseClient,
  clientId: string | null | undefined
): Promise<string | null> {
  if (!clientId) return null;
  const { data } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.content?.trim() || null;
}

export type ModelTrainingConfig = {
  id: string;
  is_active: boolean;
  business_name: string | null;
  business_description: string | null;
  target_buyer_persona: string | null;
  language: string | null;
  register: string | null;
  icebreaker_max_chars: number | null;
  subject_max_words: number | null;
  body_max_words: number | null;
  forbidden_phrases: string[];
  required_phrases: string[];
  talking_points: string[];
  value_props: string[];
  strong_decision_maker_keywords: string[];
  exclude_role_keywords: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Carga la configuración de entrenamiento activa.
 * Retorna null si no hay ninguna activa.
 */
export async function loadActiveModelTrainingConfig(
  db: SupabaseClient
): Promise<ModelTrainingConfig | null> {
  const { data, error } = await db
    .from("model_training_config")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[modelTrainingConfig] Error cargando config:", error.message);
    return null;
  }

  return data as ModelTrainingConfig | null;
}

// Verifica si la configuración tiene contenido relevante para la generación de mensajes.
export function configHasContent(config: ModelTrainingConfig | null): config is ModelTrainingConfig {
  if (!config) return false;
  return !!(
    config.business_name ||
    config.business_description ||
    config.value_props.length > 0
  );
}

// Renderiza instrucciones de configuración para el prompt de usuario.
export function renderConfigInstructions(
  config: ModelTrainingConfig | null,
  jobTitle: string | null | undefined,
  companyType: string | null | undefined
): string | null {
  if (!configHasContent(config)) return null;
  const lines: string[] = [];
  if (config.register) lines.push(`Tone/register: ${config.register}`);
  if (config.language) lines.push(`Language: ${config.language}`);
  if (config.talking_points.length > 0) {
    lines.push(`Talking points: ${config.talking_points.join("; ")}`);
  }
  if (config.required_phrases.length > 0) {
    lines.push(`Required phrases/concepts: ${config.required_phrases.join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
