import { NextRequest, NextResponse } from "next/server";
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
// GET               → lista las reuniones con feedback cuyo cliente en el
//                      sheet difiere del client_id actual. No cambia nada.
// GET ?commit=1     → aplica el client_id nuevo a esas reuniones. Nunca
//                      borra ni toca feedback.
export async function GET(req: NextRequest) {
  const commit = req.nextUrl.searchParams.get("commit") === "1";

  const result = await runMeetingsSync(true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const mismatches = (result.preview ?? []).filter(
    (p) => p.reason === "feedback_protegido" && p.meetingId && p.newClientId
  );

  if (!commit) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      total: mismatches.length,
      mismatches,
      nota: "Nada se modificó. Repetir con ?commit=1 para aplicar de verdad.",
    });
  }

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
