import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas públicas: el login, el link de research compartido (10-09-2026) y el
// link de análisis/feedback compartido (11-09-2026) — pedido explícito del
// usuario en ambos casos: el cliente externo los abre sin login, y solo ve
// el research/análisis de ESA reunión, protegido por el token impredecible
// de la URL en vez de por sesión. Todo lo demás requiere sesión de
// Supabase Auth del proyecto "peitho" (mismo patrón que
// bullseye-abm-platform/middleware.ts).
const PUBLIC_PAGE_PREFIXES = ["/login", "/research-compartido", "/analisis-compartido"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
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
    // getUser() puede rechazar (no solo devolver `error`) cuando no hay sesión,
    // según el runtime — nunca debe tumbar el middleware entero.
    console.error("middleware: fallo al verificar sesión de Supabase:", err);
  }

  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
