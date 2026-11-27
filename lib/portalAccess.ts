import { supabaseAdmin } from "@/lib/supabase";

// Último acceso del cliente a Pulso ABM (pedido de BullsEye 26-nov-2026).
// Cada usuario del portal deja su rastro al abrir el informe
// (GET /api/portal/radar) y al cambiar de vista (POST /api/portal/radar/visto).
// Sin migración: una fila por usuario en allo_response_cache,
// `portal_access:<client_users.id>` → PortalAccess (3 años).
// Una "visita" nueva = un acceso después de 30 min sin actividad.

const PREFIX = "portal_access:";
const TTL_MS = 3 * 365 * 86_400_000;
const NEW_VISIT_MS = 30 * 60_000;

export type PortalAccess = {
  first_at: string;
  last_at: string;
  visits: number;
  last_view?: string;
  views?: Record<string, { n: number; last_at: string }>;
};

export async function recordPortalAccess(portalUserId: string, view?: string | null): Promise<void> {
  try {
    const db = supabaseAdmin();
    const key = PREFIX + portalUserId;
    const { data } = await db.from("allo_response_cache").select("response").eq("cache_key", key).maybeSingle();
    const prev = (data?.response ?? null) as PortalAccess | null;
    const now = new Date().toISOString();
    const isNewVisit = !prev || Date.now() - new Date(prev.last_at).getTime() > NEW_VISIT_MS;
    const next: PortalAccess = {
      first_at: prev?.first_at ?? now,
      last_at: now,
      visits: (prev?.visits ?? 0) + (isNewVisit ? 1 : 0),
      last_view: view || prev?.last_view,
      views: { ...(prev?.views ?? {}) },
    };
    if (view) {
      const v = next.views![view];
      next.views![view] = { n: (v?.n ?? 0) + 1, last_at: now };
    }
    await db.from("allo_response_cache").upsert(
      { cache_key: key, response: next, expires_at: new Date(Date.now() + TTL_MS).toISOString() },
      { onConflict: "cache_key" }
    );
  } catch (e) {
    // Registrar el acceso nunca debe impedir ver el informe
    console.warn("[portal-access] No se pudo registrar el acceso:", (e as Error).message);
  }
}

export async function loadPortalAccess(portalUserIds: string[]): Promise<Map<string, PortalAccess>> {
  const out = new Map<string, PortalAccess>();
  if (!portalUserIds.length) return out;
  const db = supabaseAdmin();
  for (let i = 0; i < portalUserIds.length; i += 200) {
    const { data } = await db.from("allo_response_cache").select("cache_key, response")
      .in("cache_key", portalUserIds.slice(i, i + 200).map((id) => PREFIX + id));
    for (const r of data ?? []) out.set(String(r.cache_key).slice(PREFIX.length), r.response as PortalAccess);
  }
  return out;
}
