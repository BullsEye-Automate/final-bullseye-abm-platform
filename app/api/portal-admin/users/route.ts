import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { PORTAL_ROLE } from "@/lib/portalAuth";
import { generateTempPassword, getReviewerEmail } from "@/lib/portalAdmin";

export const dynamic = "force-dynamic";

// GET — usuarios del portal (?client_id= para filtrar)
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const db = supabaseAdmin();
  let q = db
    .from("client_users")
    .select("id, client_id, email, full_name, is_active, created_by, created_at, clients(name)")
    .order("created_at", { ascending: false });
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data ?? []).map((u) => {
    const c = Array.isArray(u.clients) ? u.clients[0] : u.clients;
    return { ...u, clients: undefined, client_name: (c as { name: string } | null)?.name ?? "—" };
  });
  return NextResponse.json({ users });
}

// POST — { client_id, email, full_name? } crea un usuario del portal con
// contraseña temporal, que se devuelve UNA vez para entregársela al cliente.
// Nunca reutiliza una cuenta existente: si el email ya existe en Supabase
// Auth (p. ej. alguien del equipo) se rechaza, para no convertir una cuenta
// interna en cuenta cliente.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const clientId: string = body?.client_id ?? "";
  const email: string = (body?.email ?? "").trim().toLowerCase();
  const fullName: string | null = body?.full_name?.trim() || null;
  if (!clientId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Cliente y email válido son obligatorios" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const password = generateTempPassword();
  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: PORTAL_ROLE, client_id: clientId },
    user_metadata: { full_name: fullName },
  });
  if (authErr || !created.user) {
    const exists = /already|registered|exists/i.test(authErr?.message ?? "");
    return NextResponse.json(
      { error: exists ? "Ese email ya tiene una cuenta. Usa otro email." : authErr?.message ?? "No se pudo crear el usuario" },
      { status: exists ? 409 : 500 }
    );
  }

  const { data: row, error: rowErr } = await db
    .from("client_users")
    .insert({
      auth_user_id: created.user.id,
      client_id: clientId,
      email,
      full_name: fullName,
      created_by: await getReviewerEmail(),
    })
    .select("id")
    .single();
  if (rowErr) {
    // Sin la fila en client_users el usuario no tendría acceso a nada: se
    // borra la cuenta para no dejarla huérfana.
    await db.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: row.id, email, password });
}
