import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { REPLY_CATEGORY_LABELS } from "@/lib/replyAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/respuestas/[id]/triage   body { triage?: <category|null>, handled?: boolean }
//
// Veredicto humano sobre una respuesta del inbox /respuestas:
//   - triage: corrige/confirma la categoría (override de la clasificación IA).
//     Pasar null para limpiar el override.
//   - handled: marca la respuesta como atendida (o la reabre con false).
// Ambos campos son opcionales; se actualiza solo lo que venga.
const VALID = new Set(Object.keys(REPLY_CATEGORY_LABELS));

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if ("triage" in (body as object)) {
    const t = (body as { triage?: unknown }).triage;
    if (t === null || t === "") {
      update.reply_triage = null;
    } else if (typeof t === "string" && VALID.has(t)) {
      update.reply_triage = t;
    } else {
      return NextResponse.json({ error: "triage inválido" }, { status: 400 });
    }
  }

  if ("handled" in (body as object)) {
    const h = (body as { handled?: unknown }).handled;
    update.reply_handled_at = h ? new Date().toISOString() : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nada para actualizar" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("lemlist_activities")
    .update(update)
    .eq("id", params.id)
    .select(
      "id, reply_category, reply_triage, reply_handled_at, reply_summary, reply_suggested_step"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, reply: data });
}
