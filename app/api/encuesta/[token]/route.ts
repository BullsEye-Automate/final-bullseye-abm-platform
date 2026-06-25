import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .select("id, empresa, contacto_nombre, contacto_cargo, fecha_reunion, realizado, feedback_status, meeting_feedback(*)")
    .eq("feedback_token", params.token)
    .single();

  if (error || !data) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = supabaseAdmin();
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id, feedback_status")
    .eq("feedback_token", params.token)
    .single();

  if (meetingError || !meeting) return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  if (meeting.feedback_status === "con_feedback") {
    return NextResponse.json({ error: "Esta encuesta ya fue completada" }, { status: 409 });
  }

  const body = await req.json();

  // Guardar feedback
  const { error: fbError } = await supabase
    .from("meeting_feedback")
    .insert({
      meeting_id:                 meeting.id,
      calificacion:               body.calificacion,
      empresa_calificada:         body.empresa_calificada,
      contacto_calificado:        body.contacto_calificado,
      razon_no_califica:          body.razon_no_califica || null,
      razon_no_califica_otro:     body.razon_no_califica_otro || null,
      propuesta_comercial:        body.propuesta_comercial,
      comentarios_adicionales:    body.comentarios_adicionales ?? null,
      probabilidad_cierre:        body.probabilidad_cierre ?? null,
    });

  if (fbError) return NextResponse.json({ error: fbError.message }, { status: 500 });

  // Actualizar estado de la reunión
  await supabase
    .from("meetings")
    .update({ feedback_status: "con_feedback" })
    .eq("id", meeting.id);

  return NextResponse.json({ ok: true });
}
