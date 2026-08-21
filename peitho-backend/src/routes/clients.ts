import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { uploadKnowledgeBaseDocument, deleteKnowledgeBaseDocument } from '../knowledgeBase';
import { requireAuth, requireAdmin } from '../authMiddleware';

export const clientsRouter = Router();

// Todas las rutas de este archivo las llama únicamente el frontend web
// (nunca la extensión de Chrome ni los webhooks de Google) — se exige sesión
// de Supabase Auth en todas, con permisos más finos por ruta abajo.
clientsRouter.use(requireAuth);

// En memoria (no a disco) — el archivo se sube directo a Supabase Storage,
// nunca se guarda en el filesystem del backend. 50MB porque es el límite
// FIJO del plan free de Supabase Storage (confirmado real: un intento con
// 100MB acá pasaba este límite y fallaba recién en Supabase con un error
// distinto) — si el proyecto pasa a plan Pro esto se puede subir.
const MAX_FILE_SIZE_MB = 50;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });

// multer llama a next(err) en vez de tirar la excepción — sin este wrapper,
// un archivo muy grande terminaba en el error genérico 500 de Express en vez
// de un mensaje claro (bug real: PDF de 92MB con el límite viejo de 25MB).
function uploadSingleFile(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `El archivo supera el límite de ${MAX_FILE_SIZE_MB}MB` });
      return;
    }
    console.error('Error procesando la subida del archivo', error);
    res.status(400).json({ error: 'No se pudo procesar el archivo' });
  });
}

// Listado completo de clientes — solo el admin necesita esto (para el
// selector de cliente y la gestión de la base de conocimiento de cualquiera).
clientsRouter.get('/clients', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select c.id, c.name,
              count(k.id)::int as documentos
       from clients c
       left join knowledge_base_documents k on k.client_id = c.id
       group by c.id, c.name
       order by c.name asc`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /clients', error);
    res.status(500).json({ error: 'Error consultando los clientes' });
  }
});

// Los clientes normalmente se crean solos al hacer match con el excel de
// metas (ver metasSheet.ts) — este endpoint es para el caso donde alguien
// quiere subir documentación de un cliente antes de que exista cualquier
// reunión suya en Peitho.
clientsRouter.post('/clients', requireAdmin, async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Falta el nombre del cliente' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `insert into clients (name) values ($1)
       on conflict (name) do update set name = excluded.name
       returning id, name`,
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error en POST /clients', error);
    res.status(500).json({ error: 'Error creando el cliente' });
  }
});

// Un usuario "client" puede VER (no subir/borrar) la base de conocimiento de
// su propio cliente — aclaración explícita del usuario en la Fase E.
clientsRouter.get('/clients/:id/documents', async (req, res) => {
  const { id } = req.params;

  if (req.peithoUser!.role === 'client' && req.peithoUser!.clientId !== id) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `select id, file_name, file_type, uploaded_at, (content is not null) as content_extracted
       from knowledge_base_documents
       where client_id = $1
       order by uploaded_at desc`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error en GET /clients/:id/documents', error);
    res.status(500).json({ error: 'Error consultando los documentos' });
  }
});

clientsRouter.post('/clients/:id/documents', requireAdmin, uploadSingleFile, async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    res.status(400).json({ error: 'Falta el archivo (campo "file")' });
    return;
  }

  try {
    const { rowCount } = await pool.query(`select id from clients where id = $1`, [id]);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    // Multer/busboy entregan el nombre del archivo decodificado como
    // latin1 (así llegan las cabeceras HTTP), así que cualquier caracter
    // fuera de ASCII (acentos, guiones especiales) sale con caracteres
    // corruptos si no se re-decodifica como UTF-8 — bug real visto con
    // "bullseye_icp_formatted — BullsEye.pdf".
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const result = await uploadKnowledgeBaseDocument(id, fileName, req.file.buffer);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error subiendo documento a la base de conocimiento', error);
    res.status(500).json({ error: 'Error subiendo el documento' });
  }
});

clientsRouter.delete('/clients/:id/documents/:documentId', requireAdmin, async (req, res) => {
  const { id, documentId } = req.params;
  try {
    const deleted = await deleteKnowledgeBaseDocument(id, documentId);
    if (!deleted) {
      res.status(404).json({ error: 'Documento no encontrado' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error borrando documento de la base de conocimiento', error);
    res.status(500).json({ error: 'Error borrando el documento' });
  }
});
