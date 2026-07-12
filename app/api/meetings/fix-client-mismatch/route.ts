import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El sync protege las reuniones con feedback: si el cliente cambió en la
// planilla, NO reasigna el client_id solo (para no pisar un feedback por un
// error de tipeo en el sheet). Pero cuando la planilla tiene razón y el
// client_id guardado está desactualizado, hay que poder corregirlo — sin
// tocar feedback_status ni meeting_feedback para nada (viven aparte).
//
// GET  → lista las reuniones con feedback cuyo cliente en el sheet difiere
//        del client_id actual (mismos datos que la alerta en /oportunidades/feedback).
// POST → aplica el client_id nuevo a esas reuniones. Nunca borra ni toca feedback.
export async function GET() {
  const result = await runMeetingsSync(true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const mismatches = (result.preview ?? []).filter((p) => p.reason === "feedback_protegido");
  return NextResponse.json({ ok: true, total: mismatches.length, mismatches });
}

export async function POST() {
  const result = await runMeetingsSync(true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const mismatches = (result.preview ?? []).filter(
    (p) => p.reason === "feedback_protegido" && p.meetingId && p.newClientId
  );

  const db = supabaseAdmin();
  let actualizadas = 0;
  const errors: string[] = [];

  for (const m of mismatches) {
    const { error } = await db
      .from("meetings")
      .update({ client_id: m.newClientId })
      .eq("id", m.meetingId!);
    if (error) errors.push(`${m.empresa}: ${error.message}`);
    else actualizadas++;
  }

  return NextResponse.json({
    ok: true,
    actualizadas,
    total: mismatches.length,
    errores: errors.length ? errors : undefined,
  });
}
