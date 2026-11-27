// ACTI · reglas de rutas para usuarios del portal de un socio ACTI
// (app_metadata.role = "client" y app_metadata.acti = true). Pura: la usa
// middleware.ts y las pruebas. Los usuarios cliente sin la marca ACTI no pasan
// por acá: siguen exactamente con la regla de siempre (/portal y /api/portal).

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

export const isActiRoute = (pathname: string) => under(pathname, "/acti") || under(pathname, "/api/acti");

// APIs del portal que la experiencia ACTI sí reutiliza (se agregan fase a fase)
const ALLOWED_PORTAL_APIS: string[] = [];

export type ActiRouteDecision = "allow" | "redirect" | "forbid";

export function actiClientRoute(pathname: string): ActiRouteDecision {
  if (isActiRoute(pathname)) return "allow";
  if (ALLOWED_PORTAL_APIS.some((p) => under(pathname, p))) return "allow";
  if (pathname.startsWith("/api/")) return "forbid";
  return "redirect"; // cualquier página (incluido /portal) → /acti
}
