import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: Exporta TODOS los feedbacks con sus reuniones (backup completo)
export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();

  const { data: feedbacks, error } = await supabase
    .from("meeting_feedback")
    .select(`
      id,
      meeting_id,
      calificacion,
      empresa_calificada,
      contacto_calificado,
      razon_no_califica,
      razon_no_califica_otro,
      propuesta_comercial,
      comentarios_adicionales,
      probabilidad_cierre,
      sdr_seleccionado,
      submitted_at,
      meetings!inner(
        id,
        empresa,
        contacto_nombre,
        client_id,
        feedback_token,
        created_at,
        clients!inner(id, name, slug)
      )
    `)
    .order("submitted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const backup = {
    exported_at: new Date().toISOString(),
    total_feedbacks: feedbacks?.length ?? 0,
    feedbacks: feedbacks ?? [],
  };

  // Permitir download como JSON
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="feedbacks-backup-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}
