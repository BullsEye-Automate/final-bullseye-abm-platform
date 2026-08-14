import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { uploadKnowledgeBaseDocument, deleteKnowledgeBaseDocument } from '../knowledgeBase';

export const clientsRouter = Router();

// En memoria (no a disco) — el archivo se sube directo a Supabase Storage,
// nunca se guarda en el filesystem del backend. 100MB alcanza para
// presentaciones/PDFs pesados con imágenes (se vio un caso real de 92MB)
// sin dejar la puerta abierta a subidas ilimitadas.
const MAX_FILE_SIZE_MB = 100;
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

clientsRouter.get('/clients', async (_req, res) => {
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
clientsRouter.post('/clients', async (req, res) => {
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

clientsRouter.get('/clients/:id/documents', async (req, res) => {
  const { id } = req.params;
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

clientsRouter.post('/clients/:id/documents', uploadSingleFile, async (req, res) => {
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

    const result = await uploadKnowledgeBaseDocument(id, req.file.originalname, req.file.buffer);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error subiendo documento a la base de conocimiento', error);
    res.status(500).json({ error: 'Error subiendo el documento' });
  }
});

clientsRouter.delete('/clients/:id/documents/:documentId', async (req, res) => {
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
