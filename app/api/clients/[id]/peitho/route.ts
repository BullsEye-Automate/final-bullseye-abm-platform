import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isPeithoEnabled } from "@/lib/peitho";

export const dynamic = "force-dynamic";

// "Incluir Peitho" del cliente (Config. cliente). Requiere sesión
// (middleware: /api/clients/[id]/* no es pública).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ enabled: await isPeithoEnabled(supabaseAdmin(), params.id) });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Falta enabled" }, { status: 400 });
  // upsert solo con esta columna: no toca el resto de la configuración
  const { error } = await supabaseAdmin()
    .from("client_configs")
    .upsert({ client_id: params.id, peitho_enabled: body.enabled }, { onConflict: "client_id" });
  if (error) {
    const msg = /peitho_enabled/.test(error.message)
      ? "Falta aplicar la migración supabase/20261030_prospeccion_v3_migration.sql"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ enabled: body.enabled });
}
