import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase";

// Autorización del portal de clientes (/portal, /api/portal/*).
//
// El client_id SIEMPRE sale de la tabla client_users a partir del usuario de
// la sesión — nunca de la URL, el body ni el query string. Así un usuario de
// un cliente no puede leer ni escribir datos de otro cliente cambiando un id.

// Marca en app_metadata (solo editable con service role) que usa el
// middleware para confinar a los usuarios cliente a /portal.
export const PORTAL_ROLE = "client";

export type PortalUser = {
  portalUserId: string;
  authUserId: string;
  clientId: string;
  clientName: string;
  clientLogoUrl: string | null;
  email: string;
  fullName: string | null;
};

export async function getPortalUser(): Promise<PortalUser | null> {
  const { data, error } = await supabaseServer().auth.getUser();
  if (error || !data.user) return null;

  const db = supabaseAdmin();
  const { data: row } = await db
    .from("client_users")
    .select("id, client_id, email, full_name, is_active, clients(name, logo_url, is_active)")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!row || !row.is_active) return null;
  const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as
    | { name: string; logo_url: string | null; is_active: boolean }
    | null;
  if (!client || client.is_active === false) return null;

  return {
    portalUserId: row.id,
    authUserId: data.user.id,
    clientId: row.client_id,
    clientName: client.name,
    clientLogoUrl: client.logo_url,
    email: row.email,
    fullName: row.full_name,
  };
}

// Para route handlers: devuelve el usuario o una respuesta 403 lista.
export async function requirePortalUser(): Promise<
  { user: PortalUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await getPortalUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Sin acceso al portal" }, { status: 403 }),
    };
  }
  return { user, response: null };
}
