import type { SupabaseClient } from "@supabase/supabase-js";

// Resuelve la API key de Lemlist para un cliente.
// Prioridad: key propia del cliente en client_configs → variable de entorno compartida.
export async function getLemlistApiKey(
  db: SupabaseClient,
  clientId: string | null | undefined
): Promise<string | null> {
  if (clientId) {
    const { data } = await db
      .from("client_configs")
      .select("lemlist_api_key")
      .eq("client_id", clientId)
      .maybeSingle();
    const k = (data as any)?.lemlist_api_key?.trim();
    if (k) return k;
  }
  return process.env.LEMLIST_API_KEY ?? null;
}
