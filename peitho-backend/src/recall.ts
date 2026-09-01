// Fase H — Recall.ai crea un bot ("Peitho") que se une a la reunión y la
// graba, reemplazando chrome.tabCapture (la extensión de Chrome). El audio
// grabado sigue alimentando exactamente el mismo pipeline que ya existe
// (analyzeMeetingAudio en postMeetingAnalysis.ts, vía Deepgram + Claude) —
// Recall solo reemplaza CÓMO llega el audio, no qué se hace con él.
//
// TODO — pendiente de confirmar contra la documentación real de Recall
// (docs.recall.ai/reference/bot_create y .../bot_retrieve, bloqueada desde
// este entorno por el proxy de red) antes de usar esto en producción:
//   1. El nombre exacto del campo para pasar nuestro meetingId de vuelta en
//      el webhook (se asume `metadata` acá, hay que confirmarlo).
//   2. El nombre exacto del campo con la URL de descarga de la grabación en
//      la respuesta de Retrieve Bot (se asume `recording.media_shortcuts.*`
//      o similar, placeholder abajo).
//   3. Si conviene configurar el webhook por-bot (`webhook_url` en el body
//      de Create Bot) o a nivel de cuenta desde el Dashboard de Recall.

function getRecallConfig(): { apiKey: string; region: string; loginGroupId: string | null } {
  const apiKey = process.env.RECALL_API_KEY;
  const region = process.env.RECALL_REGION;
  if (!apiKey || !region) {
    throw new Error('Faltan RECALL_API_KEY o RECALL_REGION en las variables de entorno (ver .env.example)');
  }
  return { apiKey, region, loginGroupId: process.env.RECALL_GOOGLE_LOGIN_GROUP_ID ?? null };
}

function recallApiUrl(region: string, path: string): string {
  return `https://${region}.recall.ai/api/v2${path}`;
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
    // Referencia de vuelta a nuestra reunión — ver TODO arriba, confirmar
    // que "metadata" es el campo correcto antes de depender de esto.
    metadata: { peitho_meeting_id: meetingId },
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

  // Placeholder — confirmar el path real en la respuesta de Retrieve Bot.
  const url = data?.recordings?.[0]?.media_shortcuts?.audio_mixed?.data?.download_url;
  if (!url) {
    throw new Error(`No se encontró la URL de descarga de la grabación para el bot ${botId}`);
  }
  return url;
}
