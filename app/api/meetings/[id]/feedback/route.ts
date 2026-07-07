import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = [
  "calificacion", "empresa_calificada", "razon_no_empresa", "razon_no_empresa_otro",
  "contacto_calificado", "razon_no_califica", "razon_no_califica_otro",
  "propuesta_comercial", "comentarios_adicionales", "probabilidad_cierre", "sdr_seleccionado",
];

// PATCH /api/meetings/[id]/feedback — edita campos del feedback existente
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  const { error } = await db.from("meeting_feedback").update(updates).eq("meeting_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/meetings/[id]/feedback — elimina el feedback y resetea feedback_status a pendiente
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { error: delError } = await db.from("meeting_feedback").delete().eq("meeting_id", params.id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  const { error: updError } = await db.from("meetings").update({ feedback_status: "pendiente" }).eq("id", params.id);
  if (updError) return NextResponse.json({ error: updError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
