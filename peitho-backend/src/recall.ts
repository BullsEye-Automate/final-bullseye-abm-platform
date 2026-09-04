// Fase H — Recall.ai crea un bot ("Peitho") que se une a la reunión y la
// graba, reemplazando chrome.tabCapture (la extensión de Chrome). El audio
// grabado sigue alimentando exactamente el mismo pipeline que ya existe
// (analyzeMeetingAudio en postMeetingAnalysis.ts, vía Deepgram + Claude) —
// Recall solo reemplaza CÓMO llega el audio, no qué se hace con él.
//
// Confirmado con una llamada real a la API (curl, 01-09-2026 y 03-09-2026,
// esta última con un bot que grabó una llamada real de punta a punta):
//   - El endpoint de Create/Retrieve Bot vive bajo /api/v1/bot/, NO /v2/
//     (v2 devuelve 404 — solo google-login-groups y otros recursos nuevos
//     usan v2, el recurso "bot" en sí sigue siendo v1).
//   - El campo `metadata` sí existe en el schema (confirmado, vino de vuelta
//     como `{}` en la respuesta).
//   - Por default Recall SOLO genera el video mezclado (`media_shortcuts.
//     video_mixed`) — el audio-solo (`media_shortcuts.audio_mixed`) viene
//     `null` a menos que se pida explícitamente con `audio_mixed_mp3: {}`
//     dentro de `recording_config` al crear el bot (confirmado real: sin
//     este campo, `audio_mixed` quedó `null` en la respuesta de un bot que
//     sí completó la grabación).

import { pool } from './db';
import { resolveMeetingClientAndContact } from './metasSheet';

function getRecallConfig(): { apiKey: string; region: string; loginGroupId: string | null } {
  const apiKey = process.env.RECALL_API_KEY;
  const region = process.env.RECALL_REGION;
  if (!apiKey || !region) {
    throw new Error('Faltan RECALL_API_KEY o RECALL_REGION en las variables de entorno (ver .env.example)');
  }
  return { apiKey, region, loginGroupId: process.env.RECALL_GOOGLE_LOGIN_GROUP_ID ?? null };
}

function recallApiUrl(region: string, path: string): string {
  return `https://${region}.recall.ai/api/v1${path}`;
}

const RECALL_TIMEOUT_MS = 15_000;

// Sin esto, un fetch a Recall que se cuelga (red lenta, algo raro del lado de
// Recall) deja la promesa pendiente para siempre — y con eso,
// scheduleRecallBotForMeeting() (llamado desde el sync de calendario) se
// cuelga entero. Mismo patrón que ya usa transcribeAudio en postMeetingAnalysis.ts.
async function fetchRecall(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Crea el bot programado para unirse a la reunión a la hora indicada
// (`joinAt`) — Recall lo mantiene en espera y lo hace entrar solo, no hace
// falta un cron propio para "despertar" al bot en el momento justo.
export async function createRecallBot(meetingId: string, meetingUrl: string, joinAt: Date): Promise<string> {
  const { apiKey, region, loginGroupId } = getRecallConfig();

  const body: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: 'Peitho',
    join_at: joinAt.toISOString(),
    // Referencia de vuelta a nuestra reunión — confirmado que "metadata" es
    // el campo correcto (ver nota arriba).
    metadata: { peitho_meeting_id: meetingId },
    // Solo necesitamos el audio (Deepgram, no el video) — sin esto Recall
    // no genera el shortcut `audio_mixed` (ver nota arriba).
    recording_config: { audio_mixed_mp3: {} },
  };

  // El campo google_meet solo aplica (y solo lo acepta Recall) si el link es
  // de Meet — para Teams no hace falta nada acá: el signed-in bot de Teams
  // se configura una vez a nivel de cuenta en el dashboard de Recall, no por
  // bot creado (ver CLAUDE.md, Fase H).
  if (loginGroupId && meetingUrl.includes('meet.google.com')) {
    body.google_meet = { google_login_group_id: loginGroupId };
  }

  const res = await fetchRecall(recallApiUrl(region, '/bot/'), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Recall respondió ${res.status} creando el bot: ${await res.text()}`);
  }

  const data = await res.json();
  return data.id;
}

// Se llama cuando el webhook de Recall avisa que la grabación ya está lista.
// Devuelve la URL para descargar el audio/video de la reunión.
export async function getRecallRecordingUrl(botId: string): Promise<string> {
  const { apiKey, region } = getRecallConfig();

  const res = await fetchRecall(recallApiUrl(region, `/bot/${botId}/`), {
    headers: { Authorization: `Token ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Recall respondió ${res.status} consultando el bot ${botId}: ${await res.text()}`);
  }

  const data = await res.json();

  const url = data?.recordings?.[0]?.media_shortcuts?.audio_mixed?.data?.download_url;
  if (!url) {
    throw new Error(`No se encontró la URL de descarga de la grabación para el bot ${botId}`);
  }
  return url;
}

// Dos vías para que una reunión se lleve un bot (decidido explícitamente por
// el usuario, ver CLAUDE.md Fase H): (a) hace match con el excel de metas —
// implementado acá; (b) alguien invita al bot a mano a una reunión — todavía
// no implementado, requiere sincronizar el calendario propio de
// bot@peithob2b.com (mismo mecanismo de events.watch que ya existe para los
// ejecutivos).
//
// Se llama desde dos puntos (calendarSync.ts, apenas se sincroniza el evento;
// y meetings.ts, cada vez que se carga el listado/detalle) para cubrir ambos
// timings reales: la reunión ya tiene su fila en el excel de metas cuando se
// agenda, o recién se agrega al excel después — nunca rompe nada llamarlo de
// más, es idempotente (no-op si ya tiene recall_bot_id, o si nunca hace match).
export async function scheduleRecallBotForMeeting(
  meetingId: string,
  options: { requireClientMatch?: boolean } = {}
): Promise<void> {
  if (!process.env.RECALL_API_KEY || !process.env.RECALL_REGION) return; // Recall no configurado — no-op

  // requireClientMatch=false para el disparador (b) — invitación manual del
  // bot (ver upsertMeetingFromBotInvite en calendarSync.ts): que alguien haya
  // invitado al bot a mano ya es señal suficiente de que quiere que grabe,
  // sin depender de que además haga match con el excel de metas (el match
  // sigue intentándose igual, solo para saber a qué cliente clasificarla).
  const requireClientMatch = options.requireClientMatch ?? true;

  console.log(`[recall] scheduleRecallBotForMeeting(${meetingId}) arrancó`);
  try {
    const { rows } = await pool.query(
      `select id, meet_code, meeting_url, start_time, client_id, recall_bot_id from meetings where id = $1`,
      [meetingId]
    );
    console.log(`[recall] reunión ${meetingId}: select inicial OK`);
    const meeting = rows[0];
    const meetingUrl: string | null =
      meeting?.meeting_url ?? (meeting?.meet_code ? `https://meet.google.com/${meeting.meet_code}` : null);
    if (!meeting || meeting.recall_bot_id || !meetingUrl || !meeting.start_time) {
      console.log(
        `[recall] reunión ${meetingId}: no se agenda (existe=${!!meeting}, recall_bot_id=${meeting?.recall_bot_id}, meetingUrl=${meetingUrl}, start_time=${meeting?.start_time})`
      );
      return;
    }

    const startTime = new Date(meeting.start_time);
    if (startTime.getTime() <= Date.now()) {
      console.log(`[recall] reunión ${meetingId}: start_time ya pasó (${startTime.toISOString()}), no se agenda`);
      return; // ya pasó, no tiene sentido agendar un bot
    }

    if (!meeting.client_id) {
      console.log(`[recall] reunión ${meetingId}: resolviendo cliente contra el excel de metas...`);
      await resolveMeetingClientAndContact(meetingId);
    }

    if (requireClientMatch) {
      const { rows: refreshed } = await pool.query(`select client_id from meetings where id = $1`, [meetingId]);
      if (!refreshed[0]?.client_id) {
        // Sin match en el excel de metas todavía — no se agenda (requisito
        // explícito: el bot NO entra a cualquier reunión, solo a las que
        // matchean o a las que se invita a mano).
        return;
      }
    }

    console.log(`[recall] reunión ${meetingId}: creando bot en Recall (${meetingUrl})...`);
    const botId = await createRecallBot(meetingId, meetingUrl, startTime);

    await pool.query(`update meetings set recall_bot_id = $1, updated_at = now() where id = $2`, [botId, meetingId]);
    console.log(`[recall] bot agendado (${botId}) para la reunión ${meetingId} a las ${startTime.toISOString()}`);
  } catch (error) {
    // Nunca debe romper el sync de calendario ni la carga del listado/detalle
    // de reuniones — un bot que no se pudo agendar no debe bloquear el resto.
    console.error(`[recall] error agendando el bot para la reunión ${meetingId}`, error);
  }
}
