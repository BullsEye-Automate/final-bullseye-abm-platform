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

  if (loginGroupId) {
    body.google_meet = { google_login_group_id: loginGroupId };
  }

  const res = await fetch(recallApiUrl(region, '/bot/'), {
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

  const res = await fetch(recallApiUrl(region, `/bot/${botId}/`), {
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
