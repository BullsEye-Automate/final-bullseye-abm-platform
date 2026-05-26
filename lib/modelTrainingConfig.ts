// Carga y caché de la configuración de entrenamiento del modelo de scoring.
import type { SupabaseClient } from "@supabase/supabase-js";

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
