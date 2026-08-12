import type { calendar_v3 } from 'googleapis';
import { pool } from './db';
import { getCalendarClientByEmail } from './google';

type GoogleCalendarEvent = calendar_v3.Schema$Event;

function extractMeetCode(event: GoogleCalendarEvent): string | null {
  const link = event.hangoutLink;
  if (link) return link.split('/').pop() ?? null;

  const videoEntry = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video');
  if (videoEntry?.uri) return videoEntry.uri.split('/').pop() ?? null;

  return null;
}

function extractContraparte(event: GoogleCalendarEvent, ejecutivoEmail: string) {
  const externalAttendees = (event.attendees ?? []).filter(
    (attendee) => attendee.email && attendee.email.toLowerCase() !== ejecutivoEmail.toLowerCase() && !attendee.resource
  );
  const contraparte = externalAttendees[0];
  if (!contraparte?.email) return { contraparte: null, empresaContraparte: null };

  return {
    contraparte: contraparte.displayName ?? contraparte.email,
    empresaContraparte: contraparte.email.split('@')[1] ?? null,
  };
}

async function upsertMeetingFromEvent(event: GoogleCalendarEvent, ejecutivoEmail: string) {
  if (!event.id || event.status === 'cancelled') {
    // Manejo de reuniones canceladas queda fuera del scope del MVP (ver arquitectura, sección 4)
    return;
  }

  const meetCode = extractMeetCode(event);
  if (!meetCode) return; // sin link de Meet, no es una reunión que Peitho deba capturar

  const { contraparte, empresaContraparte } = extractContraparte(event, ejecutivoEmail);
  const startTime = event.start?.dateTime ?? event.start?.date ?? null;

  await pool.query(
    `insert into meetings (google_event_id, meet_code, ejecutivo, contraparte, empresa_contraparte, start_time)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (google_event_id) do update set
       meet_code = excluded.meet_code,
       ejecutivo = excluded.ejecutivo,
       contraparte = excluded.contraparte,
       empresa_contraparte = excluded.empresa_contraparte,
       start_time = excluded.start_time,
       updated_at = now()`,
    [event.id, meetCode, ejecutivoEmail, contraparte, empresaContraparte, startTime]
  );
}

interface ChannelRow {
  id: string;
  calendar_id: string;
  sync_token: string | null;
  google_account_email: string;
}

/**
 * Google no manda el evento en el push notification, solo avisa "algo cambió".
 * Hay que ir a buscar los cambios con events.list (incremental via syncToken).
 */
export async function syncChannelChanges(channelId: string) {
  const { rows } = await pool.query<ChannelRow>(
    `select w.id, w.calendar_id, w.sync_token, c.google_account_email
     from calendar_watch_channels w
     join google_credentials c on c.id = w.google_credential_id
     where w.channel_id = $1`,
    [channelId]
  );
  const channel = rows[0];
  if (!channel) {
    console.warn(`Notificación recibida para un canal desconocido: ${channelId}`);
    return;
  }

  console.log(`[sync] canal ${channelId}: buscando credenciales de ${channel.google_account_email}...`);
  const { calendar } = await getCalendarClientByEmail(channel.google_account_email);

  let pageToken: string | undefined;
  let syncToken = channel.sync_token ?? undefined;
  let nextSyncToken: string | undefined;
  const isFirstSync = !syncToken;
  let page = 0;

  do {
    page += 1;
    console.log(`[sync] canal ${channelId}: pidiendo página ${page} a Google (syncToken=${syncToken ? 'sí' : 'no'})...`);
    let response;
    try {
      response = await calendar.events.list(
        {
          calendarId: channel.calendar_id,
          syncToken,
          pageToken,
          singleEvents: true,
          // Sin syncToken, Google devuelve TODO el historial del calendario sin
          // acotar — para una cuenta real puede ser miles de eventos viejos.
          // En la primera página de la sincronización inicial, se acota a partir de ahora.
          ...(isFirstSync && !pageToken ? { timeMin: new Date().toISOString() } : {}),
        },
        { timeout: 15_000 }
      );
    } catch (error: any) {
      if (error?.code === 410) {
        // syncToken inválido/expirado: se resincroniza completo desde ahora
        console.warn(`syncToken inválido para el canal ${channelId}, resincronizando desde ahora`);
        syncToken = undefined;
        pageToken = undefined;
        response = await calendar.events.list(
          {
            calendarId: channel.calendar_id,
            timeMin: new Date().toISOString(),
            singleEvents: true,
          },
          { timeout: 15_000 }
        );
      } else {
        throw error;
      }
    }

    console.log(`[sync] canal ${channelId}: página ${page} trajo ${response.data.items?.length ?? 0} eventos, guardando en la base...`);
    for (const event of response.data.items ?? []) {
      await upsertMeetingFromEvent(event, channel.google_account_email);
    }

    pageToken = response.data.nextPageToken ?? undefined;
    if (response.data.nextSyncToken) {
      nextSyncToken = response.data.nextSyncToken;
    }
  } while (pageToken);

  if (nextSyncToken) {
    await pool.query('update calendar_watch_channels set sync_token = $1, updated_at = now() where id = $2', [
      nextSyncToken,
      channel.id,
    ]);
  }
}
