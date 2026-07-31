import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const CRON_SECRET = process.env.CRON_SECRET;

// POST: Crea un snapshot de backup de todos los feedbacks
// Puede ser llamado manualmente o por un cron job
export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();

  // Validar si es un cron job (opcional)
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader && cronHeader !== CRON_SECRET) {
    return NextResponse.json({ error: "Cron secret inválido" }, { status: 401 });
  }

  // Traer todos los feedbacks con contexto completo
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

  const backupData = {
    exported_at: new Date().toISOString(),
    total_feedbacks: feedbacks?.length ?? 0,
    feedbacks: feedbacks ?? [],
  };

  // Guardar snapshot en la tabla de auditoría
  const { data: snapshot, error: snapshotError } = await supabase
    .from("feedback_backup_snapshots")
    .insert({
      total_feedbacks: backupData.total_feedbacks,
      backup_data: backupData,
    })
    .select()
    .single();

  if (snapshotError) {
    return NextResponse.json(
      { error: `Error guardando snapshot: ${snapshotError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    snapshot_id: snapshot.id,
    total_feedbacks: backupData.total_feedbacks,
    message: `✅ Backup de ${backupData.total_feedbacks} feedbacks guardado con éxito`,
  });
}

// GET: Lista todos los snapshots de backup realizados
export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();

  const { data: snapshots, error } = await supabase
    .from("feedback_backup_snapshots")
    .select("id, snapshot_date, total_feedbacks, created_at")
    .order("snapshot_date", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    total_snapshots: snapshots?.length ?? 0,
    snapshots: snapshots ?? [],
  });
}
