import type { calendar_v3 } from 'googleapis';
import { pool } from './db';
import { getCalendarClientByEmail } from './google';
import { scheduleRecallBotForMeeting, cancelRecallBot } from './recall';

type GoogleCalendarEvent = calendar_v3.Schema$Event;

// Bug real (09-09-2026, reunión de hacku.com/Edward Rojas): la reunión se
// reagendó en Calendar (start_time cambió) DESPUÉS de que ya existiera un
// recall_bot_id — scheduleRecallBotForMeeting solo revisa "¿ya tiene bot?" y
// si sí, no hace nada más, sin comparar si start_time cambió desde que se
// creó. El bot viejo se quedó esperando a la hora original (24h15min antes
// de la hora real) y nunca entró a la reunión reagendada — Peitho se la
// perdió por completo, sin ningún error en los logs que lo explicara.
//
// Se llama ANTES del upsert (necesita el start_time viejo, que el upsert
// está por sobreescribir) en ambos flujos de sync. Si detecta que la
// reunión ya tenía un bot Y el horario cambió Y todavía está en
// status='scheduled' (el bot no llegó a grabar nada todavía — si ya grabó,
// cancelar/recrear no tiene sentido ni es seguro), cancela el bot viejo en
// Recall y limpia recall_bot_id en la base para que
// scheduleRecallBotForMeeting (llamado después del upsert, como siempre)
// cree uno nuevo con el horario correcto.
async function cancelStaleRecallBotIfRescheduled(googleEventId: string, newStartTime: string | null): Promise<void> {
  if (!newStartTime) return;
  try {
    const { rows } = await pool.query(
      `select id, start_time, recall_bot_id, status from meetings where google_event_id = $1`,
      [googleEventId]
    );
    const existing = rows[0];
    if (!existing || !existing.recall_bot_id || existing.status !== 'scheduled') return;

    const oldStartTime = existing.start_time ? new Date(existing.start_time).getTime() : null;
    const newStartTimeMs = new Date(newStartTime).getTime();
    if (oldStartTime === newStartTimeMs) return; // no cambió, nada que hacer

    console.log(
      `[recall] reunión ${existing.id}: start_time cambió (${existing.start_time} → ${newStartTime}) y ya tenía bot ${existing.recall_bot_id} — cancelando para recrear con el horario correcto...`
    );
    await cancelRecallBot(existing.recall_bot_id);
    await pool.query(`update meetings set recall_bot_id = null, updated_at = now() where id = $1`, [existing.id]);
  } catch (error) {
    // Mismo criterio que scheduleRecallBotForMeeting: nunca debe romper el
    // sync de calendario — si falla la cancelación, el bot viejo queda
    // "colgado" con el horario equivocado (mismo bug de siempre, no uno
    // nuevo), pero el sync del resto de los eventos sigue.
    console.error(`[recall] error cancelando el bot viejo del evento ${googleEventId} para recrearlo`, error);
  }
}

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

// Link de Microsoft Teams — a diferencia de Google Meet (hangoutLink /
// conferenceData, estructurados), un evento que llegó al calendario del bot
// como invitación a una reunión de Teams normalmente no trae conferenceData
// de Google: el link queda como texto plano en location o description (así
// es como Gmail/Calendar procesan una invitación .ics ajena a Google).
const TEAMS_LINK_REGEX = /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>]+/i;

// Extrae el link completo de la reunión, sea Google Meet o Microsoft Teams —
// se usa solo para el calendario propio del bot (ver upsertMeetingFromBotInvite),
// donde el link no siempre es de Meet como asume extractMeetCode.
function extractMeetingUrl(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;

  const videoEntry = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video');
  if (videoEntry?.uri) return videoEntry.uri;

  const text = `${event.location ?? ''} ${event.description ?? ''}`;
  const teamsMatch = text.match(TEAMS_LINK_REGEX);
  if (teamsMatch) return teamsMatch[0];

  return null;
}

// Mismo dominio que INTERNAL_DOMAIN en routes/meetings.ts — acá se necesita
// para excluir a OTROS asistentes de BullsEye (ej. un segundo ejecutivo que
// acompaña a la reunión), no solo al organizador. Sin esto, si ese segundo
// asistente no es el organizador, podía quedar seleccionado como "contraparte"
// antes que el prospecto real, resolviendo empresaContraparte a
// bullseye-abm.com y ocultando la reunión entera por el filtro de
// INTERNAL_DOMAIN — confirmado real con una reunión de prueba.
const BULLSEYE_DOMAIN = 'bullseye-abm.com';

// Para un evento en el calendario propio del bot, ni el organizador (el
// ejecutivo comercial del cliente, ej. alguien de CCHC) ni el bot mismo son
// el prospecto — el prospecto es el otro asistente. Distinto del caso de
// arriba (calendario de un ejecutivo de BullsEye), donde el dueño del
// calendario SÍ es quien vende y el resto son contraparte.
//
// Bug real (09-09-2026, CCHC): se excluía solo la dirección exacta del
// organizador, no todo su dominio — en las reuniones de CCHC hay otra
// persona de CCHC además del organizador (ej. Paula Rios, citada
// aparentemente en varias reuniones) que quedaba como "contraparte" por ser
// la primera asistente externa de la lista. Eso resolvía empresa_contraparte
// a "ccc.cl" (el dominio del propio cliente, no del prospecto), y por diseño
// esa columna nunca va a matchear contra la hoja de metas — ahí "Empresa" es
// el prospecto (ej. "Intime Chile"), CCHC solo aparece en la columna
// "Cliente". Fix: excluir por dominio del organizador completo, no solo su
// dirección — así cualquier otro asistente del mismo cliente queda afuera
// igual que el organizador.
function extractContraparteFromBotInvite(event: GoogleCalendarEvent, botEmail: string) {
  const organizerEmail = event.organizer?.email?.toLowerCase();
  const organizerDomain = organizerEmail?.split('@')[1];
  const externalAttendees = (event.attendees ?? []).filter((attendee) => {
    const email = attendee.email?.toLowerCase();
    if (!email || attendee.resource) return false;
    if (email === botEmail.toLowerCase()) return false;
    const domain = email.split('@')[1];
    if (organizerDomain && domain === organizerDomain) return false;
    if (domain === BULLSEYE_DOMAIN) return false;
    return true;
  });
  const contraparte = externalAttendees[0];
  if (!contraparte?.email) return { contraparte: null, empresaContraparte: null };

  return {
    contraparte: contraparte.displayName ?? contraparte.email,
    empresaContraparte: contraparte.email.split('@')[1] ?? null,
  };
}

// Fase H, disparador (b): alguien invitó a bot@... a mano a una reunión que
// no vive en ningún calendario de BullsEye (ej. el ejecutivo comercial de un
// cliente agendó directo con el prospecto). No hay "ejecutivo" de BullsEye en
// este evento — se deja null, no se inventa un dato falso (mismo criterio
// que el resto del research). El client_id se resuelve después, igual que
// siempre, matcheando empresa_contraparte + fecha contra el excel de metas.
async function upsertMeetingFromBotInvite(event: GoogleCalendarEvent, botEmail: string) {
  console.log(`[bot-invite] procesando evento ${event.id} (status=${event.status})...`);
  if (!event.id || event.status === 'cancelled') return;

  const meetingUrl = extractMeetingUrl(event);
  console.log(`[bot-invite] evento ${event.id}: link detectado = ${meetingUrl ?? '(ninguno)'}`);
  if (!meetingUrl) return; // invitación sin link de reunión reconocible (Meet o Teams) — no es para nosotros

  const { contraparte, empresaContraparte } = extractContraparteFromBotInvite(event, botEmail);
  const startTime = event.start?.dateTime ?? event.start?.date ?? null;
  const recurringEventId = event.recurringEventId ?? null;

  await cancelStaleRecallBotIfRescheduled(event.id, startTime);

  console.log(`[bot-invite] evento ${event.id}: guardando en meetings (contraparte=${contraparte ?? '?'})...`);
  const { rows } = await pool.query(
    `insert into meetings (google_event_id, meeting_url, ejecutivo, contraparte, empresa_contraparte, start_time, recurring_event_id)
     values ($1, $2, null, $3, $4, $5, $6)
     on conflict (google_event_id) do update set
       meeting_url = excluded.meeting_url,
       contraparte = excluded.contraparte,
       empresa_contraparte = excluded.empresa_contraparte,
       start_time = excluded.start_time,
       recurring_event_id = excluded.recurring_event_id,
       updated_at = now()
     returning id`,
    [event.id, meetingUrl, contraparte, empresaContraparte, startTime, recurringEventId]
  );
  console.log(`[bot-invite] evento ${event.id}: guardado como reunión ${rows[0].id}, agendando bot...`);

  await scheduleRecallBotForMeeting(rows[0].id, { requireClientMatch: false });
  console.log(`[bot-invite] evento ${event.id}: scheduleRecallBotForMeeting terminó`);
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
  // Google marca cada ocurrencia expandida de una serie recurrente con el id
  // del evento "maestro" que la originó — null si el evento no es recurrente.
  const recurringEventId = event.recurringEventId ?? null;

  await cancelStaleRecallBotIfRescheduled(event.id, startTime);

  const { rows } = await pool.query(
    `insert into meetings (google_event_id, meet_code, ejecutivo, contraparte, empresa_contraparte, start_time, recurring_event_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (google_event_id) do update set
       meet_code = excluded.meet_code,
       ejecutivo = excluded.ejecutivo,
       contraparte = excluded.contraparte,
       empresa_contraparte = excluded.empresa_contraparte,
       start_time = excluded.start_time,
       recurring_event_id = excluded.recurring_event_id,
       updated_at = now()
     returning id`,
    [event.id, meetCode, ejecutivoEmail, contraparte, empresaContraparte, startTime, recurringEventId]
  );

  // Bug real (08-09-2026): una reunión con un prospecto externo real no
  // agendó el bot porque requireClientMatch defaulteaba a true y el match
  // con el excel de metas no había pasado todavía — el usuario tuvo que
  // crear el bot a mano en plena llamada. El match es solo para CLASIFICAR
  // a qué cliente pertenece (para el dashboard), no debería bloquear la
  // grabación. Solo se exige el match cuando la contraparte es alguien de
  // BullsEye mismo (reunión interna, ej. un standup) — cualquier contraparte
  // externa real agenda el bot igual, matchee o no con el excel.
  const isInternalMeeting = empresaContraparte?.toLowerCase() === BULLSEYE_DOMAIN;
  await scheduleRecallBotForMeeting(rows[0].id, { requireClientMatch: isInternalMeeting });
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

  // Ventana de la sincronización inicial: sin timeMax, un evento recurrente sin
  // fecha de fin (ej. "todos los días para siempre") hace que singleEvents:true
  // devuelva CADA ocurrencia futura, página tras página, sin parar nunca.
  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const initialSyncWindow = { timeMin: now.toISOString(), timeMax: ninetyDaysOut.toISOString() };

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
          // En la primera página de la sincronización inicial, se acota a los
          // próximos 90 días.
          ...(isFirstSync && !pageToken ? initialSyncWindow : {}),
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
            singleEvents: true,
            ...initialSyncWindow,
          },
          { timeout: 15_000 }
        );
      } else {
        throw error;
      }
    }

    console.log(`[sync] canal ${channelId}: página ${page} trajo ${response.data.items?.length ?? 0} eventos, guardando en la base...`);
    // El calendario de bot@... (Fase H, disparador "invitación manual") se
    // procesa distinto: ese buzón no es de ningún ejecutivo de BullsEye, así
    // que ni extractMeetCode ni extractContraparte (que asumen eso) aplican.
    const botEmail = process.env.PEITHO_BOT_GOOGLE_ACCOUNT_EMAIL;
    const isBotCalendar = !!botEmail && channel.google_account_email.toLowerCase() === botEmail.toLowerCase();
    console.log(`[sync] canal ${channelId}: isBotCalendar=${isBotCalendar} (botEmail env=${botEmail ?? '(no seteado)'})`);
    for (const event of response.data.items ?? []) {
      if (isBotCalendar) {
        await upsertMeetingFromBotInvite(event, channel.google_account_email);
      } else {
        await upsertMeetingFromEvent(event, channel.google_account_email);
      }
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
