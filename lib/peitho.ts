import type { SupabaseClient } from "@supabase/supabase-js";

// Peitho = feedback automático de las reuniones (app aparte de BullsEye).
// El cliente lo tiene contratado si client_configs.peitho_enabled = true.
// Sin la migración 20261030_prospeccion_v3 la columna no existe: se trata
// como "no contratado" en vez de romper.
export async function isPeithoEnabled(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await db.from("client_configs").select("peitho_enabled").eq("client_id", clientId).maybeSingle();
  if (error) return false;
  return !!(data as { peitho_enabled?: boolean } | null)?.peitho_enabled;
}
