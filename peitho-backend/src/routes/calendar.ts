import { Router } from 'express';
import { pool } from '../db';
import { syncChannelChanges } from '../calendarSync';
import { registerCalendarWatch } from '../calendarWatchRenewal';

export const calendarRouter = Router();

// El registro en sí (llamada a calendar.events.watch + guardado en la base)
// vive en calendarWatchRenewal.ts — lo comparte esta ruta manual con el
// renovador automático que corre solo cada 6h (ver server.ts), para no
// mantener dos copias de la misma lógica.
calendarRouter.post('/calendar/watch', async (req, res) => {
  const email = req.body?.google_account_email;
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'Falta google_account_email en el body' });
    return;
  }

  try {
    console.log(`[watch] registrando watch manual para ${email}...`);
    const { channelId, expiration } = await registerCalendarWatch(email);
    console.log(`[watch] canal ${channelId} registrado y sincronización inicial completa`);

    res.json({ status: 'ok', channel_id: channelId, expiration });
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
