import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { analyzeMeetingAudio } from '../postMeetingAnalysis';
import { generatePreMeetingBrief } from '../preMeetingBrief';
import { resolveMeetingClientAndContact } from '../metasSheet';
import { scheduleRecallBotForMeeting } from '../recall';
import { processRecallDone } from './webhooks';
import { requireAuth, requireAdmin } from '../authMiddleware';
import { getSupabaseAdminClient } from '../supabaseAdmin';

const VIDEO_BUCKET = 'meeting-videos';
// El link firmado es de un solo uso mental — se pide cada vez que el
// frontend abre la pestaña de video, no se guarda ni se reutiliza, así que
// no hace falta que dure mucho.
const VIDEO_SIGNED_URL_TTL_SECONDS = 60 * 10;

export const meetingsRouter = Router();

// Dominio propio de BullsEye — se usa para excluir reuniones internas
// (ej. dos personas del equipo) de las listas del frontend. Mismo patrón de
// hardcoding que EMPRESA_CLIENTE en postMeetingAnalysis.ts: Peitho todavía no
// modela múltiples clientes, así que esto es fijo por ahora. Exportada para
// que routes/panel.ts (Panel de control) reutilice el mismo criterio de
// exclusión en vez de duplicar el string.
export const INTERNAL_DOMAIN = 'bullseye-abm.com';

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `${req.params.id}-${Date.now()}${ext}`);
    },
  }),
});

// Lo consume el frontend (peitho-frontend): listado de reuniones futuras
// (Módulo 1) o pasadas (Módulo 2). No incluye audio_path/analysis completos
// a propósito — son pesados y no hacen falta para una vista de lista.
meetingsRouter.get('/meetings', requireAuth, async (req, res) => {
  const scope = req.query.scope;
  if (scope !== 'upcoming' && scope !== 'past') {
    res.status(400).json({ error: 'El parámetro scope debe ser "upcoming" o "past"' });
    return;
  }

  try {
    // "past" se acota a los últimos 90 días — algunas cuentas tienen reuniones
    // recurrentes sincronizadas desde antes del fix de timeMin/timeMax de la
    // Tarea 2 (ver CLAUDE.md), y sin este límite la lista se llena de
    // ocurrencias históricas de hace años que no son relevantes para revisar.
    // También se excluyen reuniones internas (contraparte con el mismo dominio
    // de BullsEye) y reuniones recurrentes (recurring_event_id no nulo) — una
    // reunión que se repite cada semana/mes casi nunca es con un prospecto
    // nuevo, y sin este filtro Google sigue generando ocurrencias futuras
    // hacia adelante indefinidamente (se vieron filas hasta el año 2051).
    // "is distinct from" en vez de "<>" para no descartar filas con
    // empresa_contraparte en null (dominio desconocido, se muestran igual).
    //
    // Excepción al filtro de dominio interno: si a la reunión se invitó al
    // bot a mano (upsertMeetingFromBotInvite en calendarSync.ts, único lugar
    // que setea meeting_url), que se haya invitado ya es señal explícita de
    // que se quiere grabar/registrar — no debe ocultarse aunque la
    // contraparte detectada termine siendo de bullseye-abm.com (ej. no hay
    // ningún asistente externo real, o quedan solo personas del equipo). Esas
    // reuniones quedan sin client_id hasta que alguien las clasifique a mano
    // o hagan match con el excel de metas.
    // pre_brief_status y has_bot: solo se usan hoy para el mini-dashboard de
    // "Reuniones futuras" (contar cuántas tienen research listo / bot
    // agendado) — livianos, no rompe el criterio de "no incluir
    // audio_path/analysis completos" de arriba (eso sigue fuera).
    const { rows } = await pool.query(
      scope === 'upcoming'
        ? `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status, client_id,
                  pre_brief_status, (recall_bot_id is not null) as has_bot
           from meetings
           where start_time >= now()
             and (meeting_url is not null or lower(empresa_contraparte) is distinct from $1)
             and recurring_event_id is null
           order by start_time asc`
        : `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status, client_id,
                  (analysis->'desempeno_vendedor'->>'puntaje')::int as puntaje,
                  (analysis->'prediccion_exito'->>'puntaje')::int as prediccion_exito
           from meetings
           where start_time < now() and start_time >= now() - interval '90 days'
             and (meeting_url is not null or lower(empresa_contraparte) is distinct from $1)
             and recurring_event_id is null
           order by start_time desc`,
      [INTERNAL_DOMAIN]
    );

    // Igual que en el detalle: se resuelve el cliente al vuelo si todavía no
    // se hizo (gratis, no llama a Claude) — necesario para poder filtrar por
    // cliente acá abajo, tanto para el rol "client" como para el filtro del admin.
    // De paso (solo en "upcoming"), intenta agendar el bot de Recall si la
    // reunión recién hizo match con el excel de metas — cubre el caso en que
    // el excel se completa después de que la reunión ya se sincronizó desde
    // Calendar (ver Fase H en CLAUDE.md). No-op si ya tiene bot o si no matchea.
    //
    // Bug real de performance encontrado (08-09-2026): esto corría en un
    // for...of con await secuencial — con muchas reuniones sin client_id (el
    // caso normal: nunca van a matchear y esto se repite en cada carga de la
    // página), cada una sumaba una consulta a Postgres una detrás de otra,
    // haciendo el listado visiblemente lento. Promise.allSettled corre las
    // filas en paralelo (acotado igual por el máximo de conexiones del pool,
    // pg default 10) — allSettled en vez de all para que una fila que falle
    // (ej. un error puntual de Recall) no tumbe la resolución de las demás.
    await Promise.allSettled(
      rows.map(async (row) => {
        if (!row.client_id) {
          await resolveMeetingClientAndContact(row.id);
        }
        if (scope === 'upcoming') {
          // requireClientMatch: false — las filas de este endpoint ya
          // pasaron el filtro SQL de arriba (sin dominio interno, o con
          // meeting_url por invitación manual al bot), así que cualquiera
          // acá es una reunión externa real: no debe depender de que
          // además haya matcheado el excel de metas (ver el mismo fix en
          // GET /meetings/:id, bug real 08-09-2026).
          await scheduleRecallBotForMeeting(row.id, { requireClientMatch: false });
        }
      })
    );

    // Se vuelve a consultar client_id/nombre del cliente después de resolver
    // arriba (la resolución puede haber cambiado filas que antes venían null).
    const ids = rows.map((row) => row.id);
    let result = rows;
    if (ids.length > 0) {
      const { rows: withClient } = await pool.query(
        `select m.id, m.client_id, c.name as cliente_bullseye from meetings m
         left join clients c on c.id = m.client_id
         where m.id = any($1)`,
        [ids]
      );
      const byId = new Map(withClient.map((r) => [r.id, r]));
      result = rows.map((row) => ({
        ...row,
        client_id: byId.get(row.id)?.client_id ?? null,
        cliente_bullseye: byId.get(row.id)?.cliente_bullseye ?? null,
      }));
    }

    const peithoUser = req.peithoUser!;
    if (peithoUser.role === 'client') {
      result = result.filter((row) => row.client_id === peithoUser.clientId);
    } else if (typeof req.query.client_id === 'string' && req.query.client_id) {
      result = result.filter((row) => row.client_id === req.query.client_id);
    }

    res.json(result);
  } catch (error) {
    console.error('Error en /meetings', error);
    res.status(500).json({ error: 'Error consultando las reuniones' });
  }
});

// La extensión de Chrome llama esto cada vez que navega a meet.google.com/{codigo}
// para saber si debe arrancar chrome.tabCapture.
meetingsRouter.get('/meetings/lookup', async (req, res) => {
  const meetCode = req.query.meet_code;
  if (typeof meetCode !== 'string' || meetCode.trim() === '') {
    res.status(400).json({ error: 'Falta el parámetro meet_code' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `select id, auto_capture
       from meetings
       where meet_code = $1
       order by abs(extract(epoch from (start_time - now())))
       limit 1`,
      [meetCode]
    );

    const meeting = rows[0];
    if (!meeting) {
      res.json({ registered: false });
      return;
    }

    res.json({
      registered: true,
      meeting_id: meeting.id,
      auto_capture: meeting.auto_capture,
    });
  } catch (error) {
    console.error('Error en /meetings/lookup', error);
    res.status(500).json({ error: 'Error consultando la reunión' });
  }
});

// Detalle de una reunión para el frontend (página de detalle del Módulo 1/2).
// A diferencia de GET /meetings (lista), sí incluye `analysis` completo.
// Registrado después de /meetings/lookup para no interceptarlo (si no, ":id"
// capturaría también la palabra literal "lookup").
meetingsRouter.get('/meetings/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Gratis (no llama a Claude) — se intenta en cada carga del detalle para
    // que nombre/cargo/industria/cliente aparezcan aunque nunca se haya usado
    // el botón "Iniciar research".
    await resolveMeetingClientAndContact(id);

    const { rows } = await pool.query(
      `select m.id, m.ejecutivo, m.contraparte, m.empresa_contraparte, m.start_time, m.status,
              m.analysis, m.pre_brief, m.pre_brief_status, m.client_id, m.transcript_text,
              m.contacto_nombre, m.contacto_cargo, m.contacto_industria, m.contacto_linkedin_url,
              (m.video_path is not null) as video_available,
              (m.recall_bot_id is not null) as recall_bot_available,
              c.name as cliente_bullseye
       from meetings m
       left join clients c on c.id = m.client_id
       where m.id = $1`,
      [id]
    );

    const meeting = rows[0];
    if (!meeting) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    // De paso, intenta agendar el bot de Recall si todavía no tiene uno
    // (no-op si ya pasó la reunión o ya tiene bot). Bug real (08-09-2026):
    // una reunión con un prospecto real (contraparte externa) nunca se
    // agendó porque requireClientMatch defaulteaba a true y esa reunión no
    // había hecho match con el excel de metas — el match es solo para
    // CLASIFICAR a qué cliente pertenece, no debería bloquear la grabación.
    // Solo se exige el match cuando la contraparte es alguien de BullsEye
    // mismo (reunión interna) — mismo criterio que INTERNAL_DOMAIN arriba.
    const isInternalMeeting = meeting.empresa_contraparte?.toLowerCase() === INTERNAL_DOMAIN;
    await scheduleRecallBotForMeeting(id, { requireClientMatch: isInternalMeeting });

    // Un usuario "client" solo puede ver el detalle de reuniones de su propio
    // client_id — se responde 404 (no 403) para no revelar que la reunión
    // existe pero es de otro cliente.
    if (req.peithoUser!.role === 'client' && meeting.client_id !== req.peithoUser!.clientId) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    res.json(meeting);
  } catch (error) {
    console.error('Error en GET /meetings/:id', error);
    res.status(500).json({ error: 'Error consultando la reunión' });
  }
});

// Devuelve una URL firmada (temporal) para reproducir el respaldo de video
// de la reunión — el bucket es privado, no se puede linkear directo. Mismo
// scoping por client_id que GET /meetings/:id (404, no 403, para no revelar
// que la reunión existe si es de otro cliente).
meetingsRouter.get('/meetings/:id/video', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(`select client_id, video_path from meetings where id = $1`, [id]);
    const meeting = rows[0];
    if (!meeting) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }
    if (req.peithoUser!.role === 'client' && meeting.client_id !== req.peithoUser!.clientId) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }
    if (!meeting.video_path) {
      res.status(404).json({ error: 'Esta reunión no tiene video disponible (venció el respaldo de 30 días, o nunca se guardó)' });
      return;
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(meeting.video_path, VIDEO_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Supabase Storage no devolvió una URL firmada');
    }

    res.json({ url: data.signedUrl });
  } catch (error) {
    console.error('Error en GET /meetings/:id/video', error);
    res.status(500).json({ error: 'Error generando el link del video' });
  }
});

// La extensión sube el audio grabado al terminar la llamada. Dispara la
// transcripción + análisis (Tarea 5) en segundo plano, sin bloquear la respuesta.
meetingsRouter.post('/meetings/:id/audio', upload.single('audio'), async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    res.status(400).json({ error: 'Falta el archivo de audio (campo "audio")' });
    return;
  }

  try {
    const { rowCount } = await pool.query(
      `update meetings set audio_path = $1, status = 'captured', updated_at = now() where id = $2`,
      [req.file.path, id]
    );

    if (rowCount === 0) {
      // La reunión no existe — borra el archivo que ya se guardó en disco para no dejarlo huérfano
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    console.log(`[audio] guardado ${req.file.path} para la reunión ${id}`);
    res.json({ status: 'ok' });

    analyzeMeetingAudio(id).catch((error) => {
      console.error(`[analysis] falló el análisis de la reunión ${id}`, error);
    });
  } catch (error) {
    console.error('Error guardando el audio de la reunión', error);
    res.status(500).json({ error: 'Error guardando el audio' });
  }
});

// Permite pegar a mano la URL de LinkedIn del contacto — usado cuando el
// research no encuentra el perfil por búsqueda (ej. nombres homónimos, como
// pasó con "Felipe Almazan"). Se guarda para que el próximo research la use
// directo con la tool web_fetch en vez de adivinar por búsqueda.
meetingsRouter.put('/meetings/:id/contacto-linkedin', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { linkedin_url } = req.body ?? {};

  if (typeof linkedin_url !== 'string') {
    res.status(400).json({ error: 'Falta el campo linkedin_url' });
    return;
  }

  const trimmed = linkedin_url.trim();
  if (trimmed && !/^https?:\/\/([\w-]+\.)*linkedin\.com\//i.test(trimmed)) {
    res.status(400).json({ error: 'La URL debe ser un link de linkedin.com' });
    return;
  }

  try {
    const { rowCount } = await pool.query(
      `update meetings set contacto_linkedin_url = $1, updated_at = now() where id = $2`,
      [trimmed || null, id]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error guardando la URL de LinkedIn del contacto', error);
    res.status(500).json({ error: 'Error guardando la URL' });
  }
});

// Corregir/asignar a mano el cliente de una reunión — admin-only. Necesario
// para reuniones que se llevan un bot por invitación manual (Fase H, punto b,
// todavía sin conectar) o cualquier caso donde el match automático contra el
// excel de metas (metasSheet.ts) se equivocó o nunca hizo match.
meetingsRouter.put('/meetings/:id/client', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { client_id } = req.body ?? {};

  if (client_id !== null && typeof client_id !== 'string') {
    res.status(400).json({ error: 'client_id debe ser un string (uuid) o null' });
    return;
  }

  try {
    if (client_id) {
      const { rowCount } = await pool.query(`select id from clients where id = $1`, [client_id]);
      if (rowCount === 0) {
        res.status(400).json({ error: 'El cliente indicado no existe' });
        return;
      }
    }

    const { rowCount } = await pool.query(
      `update meetings set client_id = $1, updated_at = now() where id = $2`,
      [client_id, id]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error corrigiendo el cliente de la reunión', error);
    res.status(500).json({ error: 'Error guardando el cliente' });
  }
});

// Recuperación manual para una reunión que quedó pegada en status='scheduled'
// pese a que el bot de Recall ya terminó de grabar — pasa cuando el proceso
// se cayó a mitad del webhook de /webhooks/recall (ej. el OOM real del
// respaldo de video, 08-09-2026, ver webhooks.ts) antes de guardar
// audio_path/transcript_text/status. Recall/Svix no reintentan el evento
// 'done' indefinidamente, así que sin esto una reunión así queda perdida para
// siempre. Requiere que la reunión ya tenga recall_bot_id (si nunca se
// agendó un bot, no hay nada que reprocesar). Corre en el mismo proceso que
// el resto del backend — no evita un OOM si el video sigue causándolo, pero
// el respaldo de video está desactivado, así que este camino ya no debería
// cargar el archivo completo en memoria.
meetingsRouter.post('/meetings/:id/reprocess', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(`select recall_bot_id, status from meetings where id = $1`, [id]);
    const meeting = rows[0];
    if (!meeting) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }
    if (!meeting.recall_bot_id) {
      res.status(400).json({ error: 'Esta reunión no tiene un bot de Recall asociado (recall_bot_id vacío)' });
      return;
    }

    console.log(`[reprocess] reunión ${id}: reprocesamiento manual solicitado (status actual=${meeting.status})...`);
    res.json({ status: 'ok' });

    processRecallDone(meeting.recall_bot_id, id).catch((error) => {
      console.error(`[reprocess] falló el reprocesamiento manual de la reunión ${id}`, error);
    });
  } catch (error) {
    console.error('Error iniciando el reprocesamiento manual de la reunión', error);
    res.status(500).json({ error: 'Error iniciando el reprocesamiento' });
  }
});

// Dispara el research pre-reunión (Paso 2 del roadmap frontend) — a diferencia
// del análisis post-reunión, esto NO es automático: el ejecutivo lo pide con
// un botón ("Iniciar research") desde el frontend, porque no todas las
// reuniones agendadas son con un prospecto real y correrlo en todas gastaría
// créditos de la API sin necesidad (requisito explícito del usuario).
meetingsRouter.post('/meetings/:id/research', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await pool.query(
      `update meetings set pre_brief_status = 'running', updated_at = now() where id = $1`,
      [id]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Reunión no encontrada' });
      return;
    }

    console.log(`[pre-brief] research iniciado para la reunión ${id}`);
    res.json({ status: 'ok' });

    generatePreMeetingBrief(id).catch((error) => {
      console.error(`[pre-brief] falló el research de la reunión ${id}`, error);
    });
  } catch (error) {
    console.error('Error iniciando el research de la reunión', error);
    res.status(500).json({ error: 'Error iniciando el research' });
  }
});
