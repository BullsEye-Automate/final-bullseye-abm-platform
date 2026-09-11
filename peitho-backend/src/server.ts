import 'dotenv/config';
import { app } from './app';
import { pool } from './db';
import { checkAndRetryFailedRecallBots, checkAndFixStaleRecallBots } from './recall';
import { retryStuckAnalyses } from './routes/webhooks';
import { deleteExpiredMeetingVideos } from './videoRetention';
import { renewExpiringCalendarWatches } from './calendarWatchRenewal';

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Cada 1 min, revisa bots de Recall que ya deberían haber intentado unirse y
// reintenta los que fallaron por el "sso_not_configured" intermitente (ver
// checkAndRetryFailedRecallBots en recall.ts) — así no depende de que alguien
// note a mano, en plena reunión, que el bot no llegó.
const RECALL_RETRY_POLL_MS = 60_000;
setInterval(() => {
  checkAndRetryFailedRecallBots().catch((error) =>
    console.error('[startup] error en el chequeo periódico de bots de Recall fallidos', error)
  );
}, RECALL_RETRY_POLL_MS);

// Mismo intervalo, chequeo aparte: bots ya agendados cuyo join_at quedó
// desalineado del start_time actual de la reunión (ej. reagendos que
// ocurrieron antes del fix de cancelStaleRecallBotIfRescheduled en
// calendarSync.ts, o cualquier otro camino futuro que reagende sin pasar por
// ahí) — ver el comentario en checkAndFixStaleRecallBots en recall.ts.
setInterval(() => {
  checkAndFixStaleRecallBots().catch((error) =>
    console.error('[startup] error en el chequeo periódico de bots de Recall desalineados', error)
  );
}, RECALL_RETRY_POLL_MS);

// Reintento automático del análisis post-reunión (10-09-2026, pedido
// explícito del usuario: "necesito que el análisis de las reuniones corra
// sola post reu") — mismo intervalo que los chequeos de Recall de arriba.
// Ver el comentario completo en retryStuckAnalyses (postMeetingAnalysis.ts):
// hoy toda reunión cae al fallback de Deepgram (el transcript nativo de
// Recall quedó revertido), y si ese paso o el llamado a Claude fallan una
// vez, nadie se entera hasta que un admin nota que quedó en "Capturada".
setInterval(() => {
  retryStuckAnalyses().catch((error) =>
    console.error('[startup] error en el chequeo periódico de análisis pegados', error)
  );
}, RECALL_RETRY_POLL_MS);

// Borra videos de reuniones con más de 30 días (ver videoRetention.ts) —
// una vez al día alcanza sobra, no hace falta más seguido que eso.
const VIDEO_RETENTION_POLL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  deleteExpiredMeetingVideos().catch((error) =>
    console.error('[startup] error en el borrado periódico de videos vencidos', error)
  );
}, VIDEO_RETENTION_POLL_MS);
// Corre también una vez al arrancar — si el servidor estuvo caído varios
// días, no hay que esperar 24h más para la primera limpieza.
deleteExpiredMeetingVideos().catch((error) =>
  console.error('[startup] error en el borrado inicial de videos vencidos', error)
);

// Bug real (11-09-2026): el watch de Calendar de bot@peithob2b.com se
// registró a mano una sola vez y nunca se volvió a renovar — Google dejó de
// avisar eventos nuevos SIN NINGÚN ERROR visible, y 4 reuniones reales de un
// cliente (Crossnet, invitó bien al bot) nunca llegaron a la base. Cada 6h
// alcanza de sobra de margen (los canales de Google duran del orden de una
// semana) para renovar cualquier cuenta conectada (ejecutivos + el bot)
// mucho antes de que expire, y corre también al arrancar por si el server
// estuvo caído más de 6h.
const CALENDAR_WATCH_RENEWAL_POLL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  renewExpiringCalendarWatches().catch((error) =>
    console.error('[startup] error en la renovación periódica de watches de Calendar', error)
  );
}, CALENDAR_WATCH_RENEWAL_POLL_MS);
renewExpiringCalendarWatches().catch((error) =>
  console.error('[startup] error en la renovación inicial de watches de Calendar', error)
);

// Si el proceso anterior murió a mitad de un research (ej. Ctrl+C, o un
// crash) el fire-and-forget nunca llegó a marcar 'failed', y esa reunión
// queda con pre_brief_status='running' para siempre — el botón "Iniciar
// research" del frontend queda deshabilitado sin ninguna forma de
// reintentarlo. Al arrancar el servidor, cualquier 'running' es
// necesariamente viejo (no hay ningún proceso en memoria trabajando en
// eso todavía), así que se resetea a 'failed' para que se pueda reintentar.
async function resetResearchColgados() {
  const { rowCount } = await pool.query(
    `update meetings set pre_brief_status = 'failed', updated_at = now() where pre_brief_status = 'running'`
  );
  if (rowCount && rowCount > 0) {
    console.log(`[startup] ${rowCount} research que habían quedado "running" de una corrida anterior, resetados a "failed"`);
  }
}

resetResearchColgados()
  .catch((error) => console.error('[startup] no se pudo resetear research colgados', error))
  .finally(() => {
    app.listen(port, () => {
      console.log(`Peitho backend escuchando en http://localhost:${port}`);
    });
  });
