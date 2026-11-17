import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateTempPassword } from "@/lib/portalAdmin";

export const dynamic = "force-dynamic";

// ~100 años: Supabase no tiene "baneo permanente", se usa una duración larga
const BAN_FOREVER = "876000h";

async function getRow(id: string) {
  const { data } = await supabaseAdmin()
    .from("client_users")
    .select("id, auth_user_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

// POST — { action: "deactivate" | "activate" | "reset_password" }
// Desactivar banea la cuenta en Supabase Auth (corta el login y el refresh
// de la sesión) además de marcar is_active = false.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const row = await getRow(params.id);
  if (!row) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const db = supabaseAdmin();

  if (action === "reset_password") {
    const password = generateTempPassword();
    const { error } = await db.auth.admin.updateUserById(row.auth_user_id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, password });
  }

  // Rol en Peitho: { peitho_role: "admin" | "sales_manager", executive_id?, executive_name? }
  // (se guarda en app_metadata sin tocar role / client_id; lib/peithoPortalRole.ts)
  if (action === "set_peitho") {
    const role = body?.peitho_role === "sales_manager" ? "sales_manager" : "admin";
    const { data: au, error: getErr } = await db.auth.admin.getUserById(row.auth_user_id);
    if (getErr || !au?.user) return NextResponse.json({ error: getErr?.message ?? "Usuario no encontrado" }, { status: 404 });
    const meta = { ...(au.user.app_metadata ?? {}) } as Record<string, unknown>;
    meta.peitho_role = role;
    meta.peitho_executive_id = role === "sales_manager" && body?.executive_id ? String(body.executive_id) : null;
    meta.peitho_executive_name = role === "sales_manager" && body?.executive_name ? String(body.executive_name).slice(0, 120) : null;
    const { error } = await db.auth.admin.updateUserById(row.auth_user_id, { app_metadata: meta });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "deactivate" || action === "activate") {
    const active = action === "activate";
    const { error } = await db.auth.admin.updateUserById(row.auth_user_id, {
      ban_duration: active ? "none" : BAN_FOREVER,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { error: updErr } = await db.from("client_users").update({ is_active: active }).eq("id", row.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}

// DELETE — elimina la cuenta (client_users se borra en cascada)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = await getRow(params.id);
  if (!row) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const { error } = await supabaseAdmin().auth.admin.deleteUser(row.auth_user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
