import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Quién administra el Centro de prospección. Equivale al "dueño" del artifact
// original: ve todas las secciones (Resumen del equipo, Efectividad, Plan
// semanal completo, Configuración) y su vista inicial es el Resumen.
// El resto del equipo con sesión entra en "Mi semana" (Plan) y puede
// registrar avance y crear solicitudes, igual que en el artifact.
// La líder y su jefa (LIDERES dentro de la página) aprueban el plan y las
// solicitudes de consumo alto aunque no estén en esta lista.
export const CENTRO_OWNER_EMAILS = [
  "amadriz@bullseye-abm.com", // Adolfo Madriz (líder de prospección)
];

export function isCentroOwner(email: string | null | undefined): boolean {
  return !!email && CENTRO_OWNER_EMAILS.includes(email.trim().toLowerCase());
}

// Usuario del equipo con sesión (los usuarios cliente del portal quedan fuera).
export async function requireCentroUser(): Promise<
  { email: string; name: string | null; response: null } | { email: null; name: null; response: NextResponse }
> {
  try {
    const { data } = await supabaseServer().auth.getUser();
    const u = data.user;
    if (u?.email && (u.app_metadata as Record<string, unknown> | undefined)?.role !== "client") {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
      return { email: u.email.toLowerCase(), name, response: null };
    }
  } catch { /* sin sesión legible */ }
  return { email: null, name: null, response: NextResponse.json({ error: "Sesión requerida" }, { status: 401 }) };
}
