import { randomUUID } from 'crypto';
import { pool } from './db';
import { getCalendarClientByEmail } from './google';
import { syncChannelChanges } from './calendarSync';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// Bug real (11-09-2026): el watch de bot@peithob2b.com se registró a mano una
// sola vez (Fase H) y nunca se volvió a renovar — Google dejó de avisar
// eventos nuevos sin ningún error visible ni en la app ni en los logs, y 4
// reuniones reales de un cliente (Crossnet) nunca llegaron a la base pese a
// que el cliente sí invitó al bot correctamente. Umbral de 48h: con el
// chequeo corriendo cada 6h (ver server.ts), sobra margen para renovar mucho
// antes de que un canal real expire, aunque el proceso esté caído un rato.
const RENEWAL_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// Misma lógica que tenía POST /calendar/watch (routes/calendar.ts) — se
// extrajo acá para que la ruta manual y la renovación automática no
// dupliquen el mismo código.
export async function registerCalendarWatch(
  email: string
): Promise<{ channelId: string; expiration: string | null }> {
  if (!PUBLIC_BASE_URL) {
    throw new Error('Falta PUBLIC_BASE_URL en las variables de entorno');
  }

  const { calendar, credentialId } = await getCalendarClientByEmail(email);

  const channelId = randomUUID();
  const webhookToken = randomUUID();

  const { data } = await calendar.events.watch(
    {
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: `${PUBLIC_BASE_URL}/webhooks/google-calendar`,
        token: webhookToken,
      },
    },
    { timeout: 15_000 }
  );

  if (!data.resourceId) {
    throw new Error('Google no devolvió resourceId para el canal');
  }

  await pool.query(
    `insert into calendar_watch_channels (google_credential_id, calendar_id, channel_id, resource_id, webhook_token, expiration)
     values ($1, 'primary', $2, $3, $4, $5)`,
    [
      credentialId,
      channelId,
      data.resourceId,
      webhookToken,
      data.expiration ? new Date(Number(data.expiration)) : null,
    ]
  );

  // Sincronización inicial: como el canal es nuevo, esto no tiene sync_token
  // todavía y trae todo lo que haya en la ventana de los próximos 90 días
  // (ver syncChannelChanges) — recupera de paso cualquier reunión que haya
  // quedado sin sincronizar mientras el canal anterior estaba muerto.
  await syncChannelChanges(channelId);

  return { channelId, expiration: data.expiration ?? null };
}

// Da de baja en Google (best-effort) y borra de la base cualquier otro canal
// de la misma cuenta — evita acumular canales duplicados apuntando a
// direcciones viejas (visto real: 2 canales simultáneos para
// bot@peithob2b.com, uno de una URL de ngrok ya muerta desde antes del
// deploy a Railway, generando ambigüedad al diagnosticar).
async function stopOtherChannels(email: string, keepChannelId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string; channel_id: string; resource_id: string }>(
    `select w.id, w.channel_id, w.resource_id
     from calendar_watch_channels w
     join google_credentials c on c.id = w.google_credential_id
     where c.google_account_email = $1 and w.channel_id != $2`,
    [email, keepChannelId]
  );
  if (rows.length === 0) return;

  const { calendar } = await getCalendarClientByEmail(email);
  for (const channel of rows) {
    try {
      await calendar.channels.stop({
        requestBody: { id: channel.channel_id, resourceId: channel.resource_id },
      });
      console.log(`[calendar-watch-renewal] canal viejo ${channel.channel_id} (${email}) dado de baja en Google.`);
    } catch (error: any) {
      // Si Google ya no lo reconoce (ej. expiró solo), no es un error real.
      console.warn(
        `[calendar-watch-renewal] no se pudo dar de baja en Google el canal ${channel.channel_id} (${email}), puede que ya haya expirado:`,
        error?.message ?? error
      );
    }
    await pool.query('delete from calendar_watch_channels where id = $1', [channel.id]);
  }
}

interface AccountChannelStatus {
  google_account_email: string;
  channel_id: string | null;
  expiration: string | null;
}

// Corre al arrancar el server y cada 6h (ver server.ts) — revisa TODAS las
// cuentas de Google conectadas (cada ejecutivo + bot@peithob2b.com), no solo
// la del bot: cualquiera de estos canales puede expirar en silencio igual, y
// una reunión real que nunca llega a la base es un problema serio para
// cualquier cuenta, no solo la del bot.
export async function renewExpiringCalendarWatches(): Promise<void> {
  const { rows: accounts } = await pool.query<AccountChannelStatus>(
    `select c.google_account_email,
            (select w.channel_id from calendar_watch_channels w
             where w.google_credential_id = c.id order by w.created_at desc limit 1) as channel_id,
            (select w.expiration from calendar_watch_channels w
             where w.google_credential_id = c.id order by w.created_at desc limit 1) as expiration
     from google_credentials c`
  );

  for (const account of accounts) {
    const email = account.google_account_email;
    const expiresAt = account.expiration ? new Date(account.expiration).getTime() : null;
    const needsRenewal = !account.channel_id || expiresAt === null || expiresAt - Date.now() < RENEWAL_THRESHOLD_MS;

    if (!needsRenewal) continue;

    console.log(
      `[calendar-watch-renewal] ${email}: canal ${account.channel_id ?? '(ninguno)'} vence ${
        account.expiration ?? '(sin fecha)'
      } — renovando...`
    );

    try {
      const { channelId } = await registerCalendarWatch(email);
      console.log(`[calendar-watch-renewal] ${email}: canal nuevo ${channelId} registrado.`);
      await stopOtherChannels(email, channelId);
    } catch (error) {
      // Nunca debe tumbar el chequeo del resto de las cuentas — se loguea y
      // se reintenta sola en el próximo ciclo (6h después).
      console.error(`[calendar-watch-renewal] ${email}: no se pudo renovar el canal`, error);
    }
  }
}
