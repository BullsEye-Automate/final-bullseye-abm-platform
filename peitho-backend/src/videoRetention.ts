// Respaldo de video de reuniones — se guarda en Supabase Storage (bucket
// "meeting-videos", ver webhooks.ts) pero solo por 30 días desde la fecha de
// la reunión, no para siempre (decisión explícita del usuario — guardar
// video sin límite crece el costo de storage mes a mes sin parar). Esta
// función borra el archivo y limpia video_path una vez pasado ese plazo;
// se llama periódicamente desde server.ts, mismo patrón que
// checkAndRetryFailedRecallBots.

import { pool } from './db';
import { getSupabaseAdminClient } from './supabaseAdmin';

const VIDEO_BUCKET = 'meeting-videos';
const VIDEO_RETENTION_DAYS = 30;

export async function deleteExpiredMeetingVideos(): Promise<void> {
  const { rows } = await pool.query(
    `select id, video_path from meetings
     where video_path is not null and start_time < now() - (interval '1 day' * $1)`,
    [VIDEO_RETENTION_DAYS]
  );
  if (rows.length === 0) return;

  console.log(`[video-retention] ${rows.length} reunión(es) con video vencido (>${VIDEO_RETENTION_DAYS} días) — borrando...`);

  const supabase = getSupabaseAdminClient();
  for (const meeting of rows) {
    try {
      const { error } = await supabase.storage.from(VIDEO_BUCKET).remove([meeting.video_path]);
      if (error) throw new Error(error.message);
      await pool.query(`update meetings set video_path = null, updated_at = now() where id = $1`, [meeting.id]);
      console.log(`[video-retention] video borrado para la reunión ${meeting.id}`);
    } catch (error) {
      // No se detiene por una reunión que falle — se reintenta en la
      // próxima corrida (video_path sigue seteado hasta que el borrado
      // realmente se confirme, para no perder la referencia sin haber
      // borrado el archivo real).
      console.error(`[video-retention] no se pudo borrar el video de la reunión ${meeting.id}`, error);
    }
  }
}
