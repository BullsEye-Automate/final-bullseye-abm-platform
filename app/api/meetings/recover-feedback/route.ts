import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/meetings/recover-feedback?client_id=X
// Lista todas las reuniones que TIENEN feedback guardado pero NO están asignadas al cliente X.
// Útil para recuperar reuniones que el sync reasignó a otro cliente.
export async function GET(req: NextRequest) {
  const db = supabaseAdmin();
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  // Reuniones con feedback que NO son del cliente solicitado
  const { data, error } = await db
    .from("meetings")
    .select("id, empresa, contacto_nombre, fecha_reunion, client_id, feedback_status, meeting_feedback(*)")
    .neq("client_id", clientId)
    .eq("feedback_status", "con_feedback");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // También buscar las que tienen feedback_status pendiente pero SÍ tienen fila en meeting_feedback
  const { data: withFeedbackRow, error: e2 } = await db
    .from("meeting_feedback")
    .select("meeting_id, meetings!inner(id, empresa, contacto_nombre, fecha_reunion, client_id, feedback_status)")
    .neq("meetings.client_id", clientId);

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({
    con_feedback_otro_cliente: data ?? [],
    total: data?.length ?? 0,
  });
}

// POST /api/meetings/recover-feedback
// Reasigna al cliente X todas las reuniones con feedback que están en otro cliente.
// Body: { client_id, meeting_ids: string[] }
export async function POST(req: NextRequest) {
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const clientId = body.client_id as string | undefined;
  const meetingIds = Array.isArray(body.meeting_ids) ? body.meeting_ids as string[] : [];

  if (!clientId) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });
  if (meetingIds.length === 0) return NextResponse.json({ error: "meeting_ids requerido" }, { status: 400 });

  const { error } = await db
    .from("meetings")
    .update({ client_id: clientId })
    .in("id", meetingIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, recovered: meetingIds.length });
}
