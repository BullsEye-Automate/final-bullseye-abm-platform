import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida el client_id que llega en la request (debe existir en clients).
export async function resolveClient(db: SupabaseClient, clientId: string | null | undefined): Promise<{ id: string; name: string; slug: string } | null> {
  if (!clientId || !UUID_RE.test(clientId)) return null;
  const { data } = await db.from("clients").select("id, name, slug").eq("id", clientId).maybeSingle();
  return (data as { id: string; name: string; slug: string } | null) ?? null;
}

// Email del usuario con sesión (las rutas ya están protegidas por middleware).
export async function currentUserEmail(): Promise<string | null> {
  try {
    const { data } = await supabaseServer().auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}
