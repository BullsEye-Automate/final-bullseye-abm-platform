import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Prefijos que NO requieren sesión: son los links mágicos que se comparten
// con clientes externos (protegidos por su propio token en la URL/DB), más
// las páginas de login. NO agregar rutas nuevas acá sin confirmar que están
// protegidas por un token individual — todo lo demás cae bajo autenticación.
const PUBLIC_PAGE_PREFIXES = [
  "/login",
  "/feedback-cliente",
  "/encuesta",
  "/forms/icp",
  "/review/empresas",
  "/revision",
  "/oportunidades/resumen-feedback/compartido",
  "/chat",
];

// Rutas de API públicas: cada una valida su propio token o secreto de webhook
// dentro del handler, así que no dependen de la sesión del middleware.
const PUBLIC_API_PREFIXES = [
  "/api/feedback-cliente",
  "/api/encuesta",
  "/api/forms/icp",
  "/api/review/empresas",
  "/api/cron", // Vercel Cron — se valida con CRON_SECRET dentro de cada route
  "/api/clay/raw-contacts", // webhooks de Clay — validan x-webhook-secret
  "/api/clay/phone-enriched",
  "/api/clay/company-no-contacts",
  "/api/clay/scored-contacts",
  "/api/test-debug", // endpoint de diagnóstico
  "/api/admin/debug-ai-usage", // endpoint de debug para auditar ai_usage_log
  "/api/agente-contenido",    // agente de contenido SDR — accesible desde /chat sin sesión
  "/api/training/segments",   // segmentos de estilo — requeridos por /chat sin sesión
];

function isPublicPath(pathname: string, method: string): boolean {
  if (PUBLIC_PAGE_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  if (PUBLIC_API_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  // /api/review-sessions/[token] (consulta puntual del link de revisión) es
  // público, pero /api/review-sessions (crear sesión) es interno.
  if (/^\/api\/review-sessions\/[^/]+/.test(pathname)) {
    return true;
  }
  // /api/resultados-compartidos/[token] (consulta puntual del dashboard
  // compartido) es público; /api/resultados-compartidos (generar el link)
  // requiere sesión.
  if (/^\/api\/resultados-compartidos\/[^/]+/.test(pathname)) {
    return true;
  }
  // Solo la lista de clientes (GET exacto) es pública porque la usa /chat
  // sin sesión. Las subrutas /api/clients/[id]/* (config con API keys de
  // Lemlist, contexto IA, borrar cliente…) requieren sesión.
  if (pathname === "/api/clients" && method === "GET") {
    return true;
  }
  // /api/feedback-config solo se expone en lectura (lo consume la página
  // pública de feedback); guardar configuración sigue requiriendo sesión.
  if (pathname === "/api/feedback-config" && method === "GET") {
    return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname, req.method)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: req });
  let user = null;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
            response = NextResponse.next({ request: req });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data, error } = await supabase.auth.getUser();
    if (!error) user = data.user;
  } catch (err) {
    // getUser() puede rechazar (no solo devolver `error`) cuando no hay
    // sesión, según el runtime — nunca debe tumbar el middleware entero.
    console.error("middleware: fallo al verificar sesión de Supabase:", err);
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Usuarios del portal de clientes (app_metadata.role = "client", solo
  // editable con service role): quedan confinados a /portal y /api/portal.
  // Las APIs del portal además validan el client_id contra client_users
  // (lib/portalAuth.ts) — esto es solo la primera barrera.
  const isPortalPath = isPortalRoute(pathname);
  if (user.app_metadata?.role === "client") {
    if (isPortalPath) return response;
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/portal", req.url));
  }

  // El equipo interno no usa el portal: lo gestiona desde /solicitudes-clientes
  if (isPortalPath && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/solicitudes-clientes", req.url));
  }

  return response;
}

function isPortalRoute(pathname: string): boolean {
  return (
    pathname === "/portal" ||
    pathname.startsWith("/portal/") ||
    pathname === "/api/portal" ||
    pathname.startsWith("/api/portal/")
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
