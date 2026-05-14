import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncLemlistActivities } from "@/lib/lemlistActivities";
import { syncReplies } from "@/lib/repliesSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Refresca el feed de Lemlist + extrae texto + clasifica con Claude — lento.
export const maxDuration = 300;

// POST /api/respuestas/sync   body opcional { analyze?: boolean }
//
// Flujo del botón "Sincronizar respuestas" de /respuestas:
//   1) syncLemlistActivities — refresca el feed de actividades de Lemlist
//      (idempotente; lo mismo que dispara /campanas).
//   2) syncReplies — sobre las actividades de tipo reply, extrae el texto
//      de la respuesta y la clasifica con Claude.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const analyze = (body as { analyze?: unknown }).analyze !== false;

  const db = supabaseAdmin();

  const activities = await syncLemlistActivities(db);
  if (!activities.ok) {
    return NextResponse.json({ ...activities, stage: "activities" }, { status: 502 });
  }

  const replies = await syncReplies(db, { analyze });
  if (!replies.ok) {
    return NextResponse.json({ ...replies, stage: "replies", activities }, { status: 502 });
  }

  return NextResponse.json({ ok: true, activities, replies });
}
