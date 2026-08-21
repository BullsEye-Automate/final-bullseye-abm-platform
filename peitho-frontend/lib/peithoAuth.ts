import { supabaseServer } from "./supabase/server";

// Server-only (Server Components y Route Handlers, ambos leen cookies vía
// next/headers) — el token se reenvía a peitho-backend como
// "Authorization: Bearer <token>" para que valide la sesión y aplique el
// scoping por cliente a nivel de API (Fase E).
export async function getAccessToken(): Promise<string | null> {
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
