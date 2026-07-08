import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = [
  "realizado", "feedback_status", "empresa",
  "contacto_nombre", "contacto_cargo", "fecha_reunion", "notas", "sdr_nombre",
];

// PATCH /api/meetings/[id] — actualiza campos de la reunión (realizado, feedback_status, etc.)
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

  const { error } = await db.from("meetings").update(updates).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/meetings/[id] — elimina la reunión (y su feedback por cascade)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  // Verificar si tiene feedback antes de eliminar (para que el cliente decida)
  const { data: meeting } = await db
    .from("meetings")
    .select("id, empresa, feedback_status")
    .eq("id", params.id)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });

  const { error } = await db.from("meetings").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, tenia_feedback: meeting.feedback_status === "con_feedback" });
}
