import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { Webhook } from 'svix';
import { pool } from '../db';
import { getRecallRecordingUrl, getRecallTranscriptUrl, getRecallVideoUrl } from '../recall';
import { analyzeMeetingAudio, buildTranscriptFromRecall } from '../postMeetingAnalysis';
import { getSupabaseAdminClient } from '../supabaseAdmin';

// Bucket privado de Supabase Storage para el respaldo de video de 30 días
// (a diferencia de audio/transcript, que se usan para el análisis y no
// necesitan reproducirse después, el video es pesado — se guarda acá en vez
// de en el disco local de Railway, igual que la Base de conocimiento). Hay
// que crearlo a mano una vez en Supabase Studio → Storage → New bucket
// (privado), igual que "knowledge-base".
const VIDEO_BUCKET = 'meeting-videos';

export const webhooksRouter = Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Bug real (08-09-2026, reunión de Noventiq con 2 bots vinculados): la
// descarga del audio/transcript de Recall usaba fetch() sin ningún timeout
// — a diferencia de casi cualquier otra llamada de red del proyecto (ver
// CLAUDE.md: "sin esto, un problema de red se manifiesta como un colgue
// silencioso e indiagnosticable"). Si la descarga se cuelga (o el proceso
// se reinicia por un deploy a mitad de camino y el retry vuelve a colgarse),
// la reunión queda pegada en status='scheduled' para siempre, sin ningún
// error en los logs que lo explique.
const DOWNLOAD_TIMEOUT_MS = 60_000;
// El video pesa mucho más que el audio-solo — le damos más margen antes de
// darlo por colgado.
const VIDEO_DOWNLOAD_TIMEOUT_MS = 180_000;
async function fetchWithTimeout(url: string, timeoutMs: number = DOWNLOAD_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Bug real (08-09-2026, reunión de Coderslab): la subida a Supabase Storage
// (supabase-js) no acepta un AbortSignal como fetch() — sin esto, un upload
// colgado (red lenta, bucket mal configurado, lo que sea) se queda
// esperando para siempre igual que el bug de arriba, sin ningún error en
// los logs. Promise.race no cancela la operación real, pero al menos deja
// de esperarla — el proceso puede seguir en vez de quedar pegado.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout (${label})`)), timeoutMs)),
  ]);
}

// Recall entrega sus webhooks vía Svix — si RECALL_WEBHOOK_SECRET está seteada
// (Recall Dashboard → Webhooks → tu endpoint → "Signing Secret", empieza con
// "whsec_"), se verifica la firma contra el body crudo (req.rawBody, capturado
// en app.ts). Sin esa variable, se acepta sin verificar (arranque rápido en
// local/dev) — seteala en producción antes de exponer esta URL públicamente.
function verifyRecallWebhook(req: any): { event: string; data: any } | null {
  const body = req.rawBody as Buffer | undefined;
  if (!body) {
    console.error(
      `[webhooks/recall] rechazado: no hay rawBody (content-type recibido: "${req.header('content-type')}")`
    );
    return null;
  }

  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (!secret) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      console.error('[webhooks/recall] rechazado: RECALL_WEBHOOK_SECRET no seteada y el body no es JSON válido');
      return null;
    }
  }

  // Recall manda los headers con el naming del estándar "Standard Webhooks"
  // (webhook-id/webhook-timestamp/webhook-signature), no el legacy svix-*
  // — confirmado real viendo un intento fallido en el dashboard de Recall.
  // La librería `svix` igual espera el objeto de headers con claves svix-*,
  // así que se leen con cualquiera de los dos nombres y se remapean.
  const svixId = req.header('webhook-id') ?? req.header('svix-id');
  const svixTimestamp = req.header('webhook-timestamp') ?? req.header('svix-timestamp');
  const svixSignature = req.header('webhook-signature') ?? req.header('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error(
      `[webhooks/recall] rechazado: faltan headers de firma (id=${!!svixId}, timestamp=${!!svixTimestamp}, signature=${!!svixSignature})`
    );
    return null;
  }

  try {
    // wh.verify() en esta versión de la librería `svix` NO devuelve el
    // payload parseado — su tipo de retorno es literalmente `undefined`,
    // solo lanza una excepción si la firma es inválida. Confirmado real: sin
    // este fix, un webhook con firma VÁLIDA igual se rechazaba con 401 en
    // silencio (sin ningún error), porque `payload` quedaba `undefined` pase
    // lo que pase — nunca se llegó a ver "firma inválida" en los logs porque
    // la firma nunca fue el problema.
    const wh = new Webhook(secret);
    wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    console.error('[webhooks/recall] firma inválida', error);
    return null;
  }
}

// Respaldo de video (30 días) — se llama SIN esperar (fire-and-forget) desde
// el handler principal, después de que audio/transcript/análisis ya se
// guardaron. Bug real (08-09-2026, reunión de Coderslab): antes esto corría
// ANTES del UPDATE que guarda audio_path/transcript_text/status, en la misma
// cadena de awaits — cuando la subida a Supabase Storage se colgó (ver
// withTimeout arriba), bloqueó que se guardara TODO, incluido el audio ya
// descargado, dejando la reunión pegada en status='scheduled' para siempre
// aunque el bot sí hubiera grabado bien. Ahora un cuelgue acá nunca puede
// bloquear el camino crítico (audio + transcripción + análisis).
async function saveVideoBackup(botId: string, meetingId: string): Promise<void> {
  try {
    console.log(`[webhooks/recall] bot ${botId}: bajando video para la reunión ${meetingId}...`);
    const videoUrl = await getRecallVideoUrl(botId);
    const videoRes = await fetchWithTimeout(videoUrl, VIDEO_DOWNLOAD_TIMEOUT_MS);
    if (!videoRes.ok) {
      throw new Error(`Descarga del video respondió ${videoRes.status}`);
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const storagePath = `${meetingId}/${Date.now()}.mp4`;
    const supabase = getSupabaseAdminClient();
    const { error: uploadError } = await withTimeout(
      supabase.storage.from(VIDEO_BUCKET).upload(storagePath, videoBuffer, { contentType: 'video/mp4' }),
      VIDEO_DOWNLOAD_TIMEOUT_MS,
      'subida a Supabase Storage'
    );
    if (uploadError) throw new Error(`Supabase Storage respondió: ${uploadError.message}`);

    await pool.query(`update meetings set video_path = $1, updated_at = now() where id = $2`, [
      storagePath,
      meetingId,
    ]);
    console.log(`[webhooks/recall] video guardado en ${VIDEO_BUCKET}/${storagePath} para la reunión ${meetingId}`);
  } catch (error) {
    console.error(`[webhooks/recall] no se pudo guardar el video para el bot ${botId}`, error);
  }
}

// Recall manda un webhook por cada cambio de estado del bot (joining_call,
// in_call_recording, done, fatal, ...) — solo nos importa "done" (grabación
// lista para descargar). El resto se ignora silenciosamente (200, sin acción).
webhooksRouter.post('/webhooks/recall', async (req, res) => {
  console.log(
    `[webhooks/recall] POST recibido — headers: ${JSON.stringify({
      'content-type': req.header('content-type'),
      'webhook-id': req.header('webhook-id'),
      'webhook-timestamp': req.header('webhook-timestamp'),
      'webhook-signature': req.header('webhook-signature'),
    })}`
  );
  let payload: { event: string; data: any } | null;
  try {
    payload = verifyRecallWebhook(req);
  } catch (error) {
    console.error('[webhooks/recall] excepción no capturada en verifyRecallWebhook', error);
    payload = null;
  }
  if (!payload) {
    res.status(401).json({ error: 'Firma de webhook inválida o body faltante' });
    return;
  }

  const statusCode = payload?.data?.data?.code;
  const botId = payload?.data?.bot?.id;
  const meetingIdFromMetadata = payload?.data?.bot?.metadata?.peitho_meeting_id;

  // Respondemos 200 de inmediato — Recall/Svix reintenta si no le contestamos
  // rápido, y descargar+transcribir puede tardar varios minutos.
  res.json({ status: 'ok' });

  if (statusCode !== 'done' || !botId) {
    return;
  }

  try {
    const { rows } = await pool.query(
      `select id, audio_path, status from meetings where recall_bot_id = $1 or ($2::text is not null and id = $2::uuid)`,
      [botId, meetingIdFromMetadata ?? null]
    );
    const meeting = rows[0];
    if (!meeting) {
      console.error(`[webhooks/recall] no se encontró ninguna reunión para el bot ${botId}`);
      return;
    }

    // Idempotencia — Svix puede reintentar la misma entrega ("done" es un
    // evento único por bot, pero mejor no volver a descargar/transcribir si
    // ya se hizo).
    if (meeting.status === 'captured' || meeting.status === 'analyzed') {
      console.log(`[webhooks/recall] reunión ${meeting.id} ya estaba en status=${meeting.status}, se ignora`);
      return;
    }

    console.log(`[webhooks/recall] bot ${botId}: descargando audio para la reunión ${meeting.id}...`);
    const downloadUrl = await getRecallRecordingUrl(botId);

    const audioRes = await fetchWithTimeout(downloadUrl);
    if (!audioRes.ok) {
      throw new Error(`Descarga del audio respondió ${audioRes.status}`);
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const audioPath = path.join(uploadsDir, `${meeting.id}-${Date.now()}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);

    // El transcript de Recall (nombre real de cada hablante, ver
    // postMeetingAnalysis.ts) reemplaza a Deepgram para el análisis — si por
    // algo falla (ej. no se generó a tiempo), no se aborta todo el flujo:
    // el audio ya descargado queda como respaldo y analyzeMeetingAudio cae
    // a Deepgram sobre él si transcript_text quedó vacío.
    let transcriptText: string | null = null;
    try {
      console.log(`[webhooks/recall] bot ${botId}: bajando transcript para la reunión ${meeting.id}...`);
      const transcriptUrl = await getRecallTranscriptUrl(botId);
      const transcriptRes = await fetchWithTimeout(transcriptUrl);
      if (!transcriptRes.ok) {
        throw new Error(`Descarga del transcript respondió ${transcriptRes.status}`);
      }
      const segments = await transcriptRes.json();
      transcriptText = buildTranscriptFromRecall(segments) || null;
    } catch (error) {
      console.error(`[webhooks/recall] no se pudo bajar el transcript de Recall para el bot ${botId}`, error);
    }

    await pool.query(
      `update meetings set audio_path = $1, transcript_text = $2, status = 'captured', updated_at = now() where id = $3`,
      [audioPath, transcriptText, meeting.id]
    );

    console.log(`[webhooks/recall] audio guardado en ${audioPath} para la reunión ${meeting.id}`);

    analyzeMeetingAudio(meeting.id).catch((error) => {
      console.error(`[webhooks/recall] falló el análisis de la reunión ${meeting.id}`, error);
    });

    // DESACTIVADO (08-09-2026): saveVideoBackup() cargaba el video entero en
    // memoria (Buffer.from(await videoRes.arrayBuffer())) antes de subirlo a
    // Supabase Storage — con un video de varios cientos de MB esto reventó la
    // RAM del contenedor de Railway y mató el proceso a mitad de camino (el
    // correo de Railway confirmó "deployment ran out of memory"), sin ningún
    // error en los logs porque un OOM mata el proceso de un tazo. Esto pasaba
    // AUNQUE ya sea fire-and-forget y corra después de guardar audio/análisis
    // — un OOM se lleva puesto todo el proceso, no solo esta función. Queda
    // apagado hasta reescribirlo con streaming (pipe directo de la descarga a
    // la subida, sin buffer completo en memoria) — no borrar saveVideoBackup(),
    // es la base para esa reescritura.
    // saveVideoBackup(botId, meeting.id).catch((error) => {
    //   console.error(`[webhooks/recall] error inesperado guardando el video del bot ${botId}`, error);
    // });
  } catch (error) {
    console.error(`[webhooks/recall] error procesando el bot ${botId}`, error);
  }
});
