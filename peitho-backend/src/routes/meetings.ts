import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { analyzeMeetingAudio } from '../postMeetingAnalysis';
import { generatePreMeetingBrief } from '../preMeetingBrief';
import { resolveMeetingClientAndContact } from '../metasSheet';
import { scheduleRecallBotForMeeting } from '../recall';
import { requireAuth, requireAdmin } from '../authMiddleware';

export const meetingsRouter = Router();

// Dominio propio de BullsEye — se usa para excluir reuniones internas
// (ej. dos personas del equipo) de las listas del frontend. Mismo patrón de
// hardcoding que EMPRESA_CLIENTE en postMeetingAnalysis.ts: Peitho todavía no
// modela múltiples clientes, así que esto es fijo por ahora.
const INTERNAL_DOMAIN = 'bullseye-abm.com';

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
    const { rows } = await pool.query(
      scope === 'upcoming'
        ? `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status, client_id
           from meetings
           where start_time >= now()
             and lower(empresa_contraparte) is distinct from $1
             and recurring_event_id is null
           order by start_time asc`
        : `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status, client_id
           from meetings
           where start_time < now() and start_time >= now() - interval '90 days'
             and lower(empresa_contraparte) is distinct from $1
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
    for (const row of rows) {
      if (!row.client_id) {
        await resolveMeetingClientAndContact(row.id);
      }
      if (scope === 'upcoming') {
        await scheduleRecallBotForMeeting(row.id);
      }
    }

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
    // el botón "Iniciar research". De paso, intenta agendar el bot de Recall
    // si recién hizo match (no-op si ya pasó la reunión o ya tiene bot).
    await resolveMeetingClientAndContact(id);
    await scheduleRecallBotForMeeting(id);

    const { rows } = await pool.query(
      `select m.id, m.ejecutivo, m.contraparte, m.empresa_contraparte, m.start_time, m.status,
              m.analysis, m.pre_brief, m.pre_brief_status, m.client_id,
              m.contacto_nombre, m.contacto_cargo, m.contacto_industria, m.contacto_linkedin_url,
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
