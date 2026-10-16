// Caché por mes de los agregados de Allo y HubSpot del módulo Células SDR.
// Reutiliza la tabla compartida allo_response_cache (ver
// supabase/allo_response_cache_migration.sql) con claves propias. Traer un
// mes completo de llamadas de Allo para todos los números toma bastante
// (Allo limita a 5 req/s para todo el workspace — ver lib/allo.ts), así que:
// - mes en curso: se recalcula cada 10 minutos;
// - meses cerrados: casi no cambian, se guardan por 12 horas.
// El botón "Actualizar" de la pantalla fuerza el recálculo (refresh=1).
import { supabaseAdmin } from "@/lib/supabase";

export function monthCacheTtlMs(month: string, currentMonth: string): number {
  return month >= currentMonth ? 10 * 60_000 : 12 * 3600_000;
}

export async function readMonthCache<T>(key: string): Promise<T | undefined> {
  try {
    const { data } = await supabaseAdmin()
      .from("allo_response_cache")
      .select("response, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) return data.response as T;
  } catch (err) {
    console.error("Lectura de caché de Células SDR falló, se sigue sin caché:", err);
  }
  return undefined;
}

export async function writeMonthCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("allo_response_cache")
      .upsert(
        { cache_key: key, response: value, expires_at: new Date(Date.now() + ttlMs).toISOString() },
        { onConflict: "cache_key" }
      );
    if (error) console.error("No se pudo guardar caché de Células SDR:", error.message);
  } catch (err) {
    console.error("No se pudo guardar caché de Células SDR:", err);
  }
}
