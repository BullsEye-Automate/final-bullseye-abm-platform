import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { analyzeMeetingAudio } from '../postMeetingAnalysis';
import { generatePreMeetingBrief } from '../preMeetingBrief';

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
meetingsRouter.get('/meetings', async (req, res) => {
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
    // de BullsEye) — a Peitho solo le interesan reuniones con prospectos.
    // "is distinct from" en vez de "<>" para no descartar filas con
    // empresa_contraparte en null (dominio desconocido, se muestran igual).
    const { rows } = await pool.query(
      scope === 'upcoming'
        ? `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status
           from meetings
           where start_time >= now()
             and lower(empresa_contraparte) is distinct from $1
           order by start_time asc`
        : `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status
           from meetings
           where start_time < now() and start_time >= now() - interval '90 days'
             and lower(empresa_contraparte) is distinct from $1
           order by start_time desc`,
      [INTERNAL_DOMAIN]
    );

    res.json(rows);
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
meetingsRouter.get('/meetings/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `select id, ejecutivo, contraparte, empresa_contraparte, start_time, status,
              analysis, pre_brief, pre_brief_status
       from meetings
       where id = $1`,
      [id]
    );

    const meeting = rows[0];
    if (!meeting) {
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

// Dispara el research pre-reunión (Paso 2 del roadmap frontend) — a diferencia
// del análisis post-reunión, esto NO es automático: el ejecutivo lo pide con
// un botón ("Iniciar research") desde el frontend, porque no todas las
// reuniones agendadas son con un prospecto real y correrlo en todas gastaría
// créditos de la API sin necesidad (requisito explícito del usuario).
meetingsRouter.post('/meetings/:id/research', async (req, res) => {
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
