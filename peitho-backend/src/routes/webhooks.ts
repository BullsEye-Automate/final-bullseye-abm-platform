import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { Webhook } from 'svix';
import { pool } from '../db';
import { getRecallRecordingUrl } from '../recall';
import { analyzeMeetingAudio } from '../postMeetingAnalysis';

export const webhooksRouter = Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      throw new Error(`Descarga del audio respondió ${audioRes.status}`);
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const audioPath = path.join(uploadsDir, `${meeting.id}-${Date.now()}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);

    await pool.query(`update meetings set audio_path = $1, status = 'captured', updated_at = now() where id = $2`, [
      audioPath,
      meeting.id,
    ]);

    console.log(`[webhooks/recall] audio guardado en ${audioPath} para la reunión ${meeting.id}`);

    analyzeMeetingAudio(meeting.id).catch((error) => {
      console.error(`[webhooks/recall] falló el análisis de la reunión ${meeting.id}`, error);
    });
  } catch (error) {
    console.error(`[webhooks/recall] error procesando el bot ${botId}`, error);
  }
});
