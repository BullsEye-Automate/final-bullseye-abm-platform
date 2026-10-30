import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase/server";

// Helpers para la gestión interna del portal (Empresas, Config. cliente, ICP).
// Estas rutas solo las alcanza el equipo BullsEye: el middleware bloquea a
// los usuarios cliente fuera de /portal y /api/portal.

// Email del usuario interno de la sesión, para registrar quién aprobó
export async function getReviewerEmail(): Promise<string> {
  const { data } = await supabaseServer().auth.getUser();
  return data.user?.email ?? process.env.APP_DEFAULT_REVIEWER_EMAIL ?? "system";
}

// Contraseña temporal legible (sin caracteres ambiguos) para entregar al cliente
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 7)}-${out.slice(7)}`;
}
