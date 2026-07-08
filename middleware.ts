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

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
