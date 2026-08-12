import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../db';
import { getCalendarClientByEmail } from '../google';
import { syncChannelChanges } from '../calendarSync';

export const calendarRouter = Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

calendarRouter.post('/calendar/watch', async (req, res) => {
  const email = req.body?.google_account_email;
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'Falta google_account_email en el body' });
    return;
  }
  if (!PUBLIC_BASE_URL) {
    res.status(500).json({ error: 'Falta PUBLIC_BASE_URL en las variables de entorno' });
    return;
  }

  try {
    console.log(`[watch] buscando credenciales para ${email}...`);
    const { calendar, credentialId } = await getCalendarClientByEmail(email);
    console.log('[watch] credenciales OK, llamando a calendar.events.watch...');

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
    console.log('[watch] events.watch respondió, guardando canal en la base...');

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
    console.log('[watch] canal guardado, arrancando sincronización inicial...');

    // Sincronización inicial: deja un sync_token de partida para futuras notificaciones
    await syncChannelChanges(channelId);
    console.log('[watch] sincronización inicial completa');

    res.json({ status: 'ok', channel_id: channelId, expiration: data.expiration });
  } catch (error) {
    console.error('Error registrando el watch de Calendar', error);
    res.status(500).json({ error: 'No se pudo registrar el watch. Revisa los logs del servidor.' });
  }
});

calendarRouter.post('/webhooks/google-calendar', async (req, res) => {
  const channelId = req.header('X-Goog-Channel-ID');
  const token = req.header('X-Goog-Channel-Token');
  const resourceState = req.header('X-Goog-Resource-State');

  // Google espera 200 casi de inmediato — respondemos antes de procesar.
  res.status(200).end();

  if (!channelId) return;

  try {
    const { rows } = await pool.query('select webhook_token from calendar_watch_channels where channel_id = $1', [
      channelId,
    ]);
    const expectedToken = rows[0]?.webhook_token;
    if (!expectedToken || expectedToken !== token) {
      console.warn(`Webhook de Calendar con token inválido para el canal ${channelId}`);
      return;
    }

    if (resourceState === 'sync') {
      // Confirmación inicial al crear el canal, todavía no hay cambios que procesar
      return;
    }

    await syncChannelChanges(channelId);
  } catch (error) {
    console.error('Error procesando webhook de Calendar', error);
  }
});
