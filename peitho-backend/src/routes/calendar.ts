import { Router } from 'express';
import { pool } from '../db';
import { syncChannelChanges } from '../calendarSync';
import { registerCalendarWatch } from '../calendarWatchRenewal';
import { requireAuth, requireAdmin } from '../authMiddleware';

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

// Bug real (08-10-2026, reunión de Callegari Automotriz/OTIC CChC): una
// invitación al bot que llegó por un link de Teams con formato válido
// igual no apareció nunca en Peitho — el usuario no pudo forzar un
// re-sync sacando/agregando al bot como invitado porque no es el dueño de
// esa cita (solo el organizador puede editar invitados), a diferencia del
// caso anterior (Cursos360) donde sí podía. `registerCalendarWatch` crea un
// canal de watch NUEVO (sin sync_token) y de paso corre `syncChannelChanges`
// con ese canal — sin sync_token, Google no hace un sync incremental (que
// nunca reintenta un evento que ya procesó antes, haya fallado o no), sino
// que trae TODO de nuevo dentro de la ventana de 90 días — la única forma de
// forzar que Peitho reintente un evento que no cambió desde que Google lo
// mandó la primera vez. Mismo mecanismo que ya usa la renovación automática
// cada 6h, expuesto acá como botón manual admin-only para no depender de
// esperar el próximo ciclo.
calendarRouter.post('/admin/calendar/bot/resync', requireAuth, requireAdmin, async (req, res) => {
  const botEmail = process.env.PEITHO_BOT_GOOGLE_ACCOUNT_EMAIL;
  if (!botEmail) {
    res.status(400).json({ error: 'Falta PEITHO_BOT_GOOGLE_ACCOUNT_EMAIL en las variables de entorno' });
    return;
  }

  try {
    console.log(`[watch] admin pidió una resincronización completa del calendario del bot (${botEmail})...`);
    const { channelId, expiration } = await registerCalendarWatch(botEmail);
    console.log(`[watch] canal ${channelId} registrado y resincronización completa del bot terminada`);
    res.json({ status: 'ok', channel_id: channelId, expiration });
  } catch (error) {
    console.error('Error resincronizando el calendario del bot', error);
    res.status(500).json({ error: 'No se pudo resincronizar. Revisá los logs del servidor.' });
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
