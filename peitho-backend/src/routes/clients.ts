import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { pool } from '../db';
import {
  uploadKnowledgeBaseDocument,
  deleteKnowledgeBaseDocument,
  fetchAndStoreWebsiteContent,
  resolveClientGroupIds,
  KB_CATEGORY_KEYS,
  KbCategoryKey,
} from '../knowledgeBase';
import { requireAuth, requireAdmin } from '../authMiddleware';
import { syncClientesDesdeMaestra } from '../clientesMaestra';

export const clientsRouter = Router();

// Todas las rutas de este archivo las llama únicamente el frontend web
// (nunca la extensión de Chrome ni los webhooks de Google) — se exige sesión
// de Supabase Auth en todas, con permisos más finos por ruta abajo.
//
// Bug real encontrado (04-09-2026): sin el prefijo '/clients' acá, este
// middleware se aplicaba a CUALQUIER request que llegara a esta altura de la
// cadena — como clientsRouter se monta sin path propio (app.use(clientsRouter)
// en app.ts), Express lo hace pasar por acá a TODO lo que no haya sido
// respondido ya por un router anterior. Eso bloqueaba silenciosamente
// /webhooks/recall (registrado después) con 401 "Falta el token de sesión",
// sin que el código de webhooks.ts llegara siquiera a ejecutarse.
clientsRouter.use('/clients', requireAuth);

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
//
// ?grouped=true (pedido explícito del usuario, 10-09-2026): la Base de
// conocimiento (/base-de-conocimiento) debe mostrar un solo ítem por grupo de
// `external_id` (ej. "CChC"/"CChC - Valle" cuentan como un solo ICP — ver
// resolveClientGroupIds en knowledgeBase.ts), con el conteo de documentos
// sumado entre todos los miembros del grupo. El listado SIN el query param
// (usado por el selector de cliente de una reunión — AssignClientForm,
// InlineClientSelect) sigue devolviendo una fila por cada `clients.id` real,
// sin agrupar: ahí sí hace falta distinguir "CChC" de "CChC - Valle" porque
// son reuniones agendadas para prospectos distintos.
clientsRouter.get('/clients', requireAdmin, async (req, res) => {
  const grouped = req.query.grouped === 'true';
  try {
    const { rows } = await pool.query(
      grouped
        ? `select min(c.id) as id,
                  string_agg(distinct c.name, ' + ' order by c.name) as name,
                  (array_agg(c.website_url) filter (where c.website_url is not null))[1] as website_url,
                  count(distinct k.id)::int as documentos
           from clients c
           left join knowledge_base_documents k on k.client_id = c.id
           group by coalesce(c.external_id, c.id::text)
           order by name asc`
        : `select c.id, c.name, c.website_url,
                  count(k.id)::int as documentos
           from clients c
           left join knowledge_base_documents k on k.client_id = c.id
           group by c.id, c.name, c.website_url
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
// reunión suya en Peitho. external_id es opcional — pedido explícito del
// usuario (10-09-2026): permite pegar el mismo "ID Cliente" que usa la
// maestra de BullsEye para vincular con otra herramienta interna, incluso
// creando el cliente a mano de a uno (fuera del sync masivo de abajo).
clientsRouter.post('/clients', requireAdmin, async (req, res) => {
  const { name, external_id: externalId } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Falta el nombre del cliente' });
    return;
  }
  if (externalId !== undefined && externalId !== null && typeof externalId !== 'string') {
    res.status(400).json({ error: 'external_id debe ser un string o null' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `insert into clients (name, external_id) values ($1, $2)
       on conflict (name) do update set name = excluded.name,
         external_id = coalesce(excluded.external_id, clients.external_id)
       returning id, name, external_id`,
      [name.trim(), externalId?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error en POST /clients', error);
    res.status(500).json({ error: 'Error creando el cliente' });
  }
});

// Sincronización masiva contra la maestra de clientes de BullsEye (otra
// pestaña del mismo spreadsheet de metas) — crea/actualiza todos los
// clientes con Status Cliente = "Activo", con su external_id. Reusable
// (botón en /base-de-conocimiento), no un script de una sola vez — la
// maestra puede cambiar con el tiempo.
clientsRouter.post('/clients/sync-maestra', requireAdmin, async (_req, res) => {
  try {
    const result = await syncClientesDesdeMaestra();
    res.json(result);
  } catch (error) {
    console.error('Error en POST /clients/sync-maestra', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error sincronizando la maestra de clientes' });
  }
});

// Pedido explícito del usuario (10-09-2026): guardar la URL del sitio del
// cliente y de paso traer su contenido a la base de conocimiento
// (fetchAndStoreWebsiteContent) — admin-only, mismo criterio que
// subir/borrar documentos. Guarda la URL siempre; si el fetch del contenido
// falla (sitio caído, bloqueado, etc.) no rompe la respuesta — se informa
// en el JSON para que el frontend lo muestre, pero la URL queda guardada
// igual y se puede reintentar después.
clientsRouter.put('/clients/:id/website', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { website_url: websiteUrl } = req.body ?? {};

  if (websiteUrl !== null && typeof websiteUrl !== 'string') {
    res.status(400).json({ error: 'website_url debe ser un string o null' });
    return;
  }
  const trimmed = websiteUrl?.trim() || null;
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    res.status(400).json({ error: 'La URL debe empezar con http:// o https://' });
    return;
  }

  try {
    const { rowCount } = await pool.query(`update clients set website_url = $1 where id = $2`, [trimmed, id]);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    if (!trimmed) {
      res.json({ status: 'ok', fetched: false });
      return;
    }

    const fetchResult = await fetchAndStoreWebsiteContent(id, trimmed);
    res.json({ status: 'ok', fetched: fetchResult.ok, fetch_error: fetchResult.ok ? null : fetchResult.error });
  } catch (error) {
    console.error('Error en PUT /clients/:id/website', error);
    res.status(500).json({ error: 'Error guardando la URL del sitio' });
  }
});

// Un usuario "client" puede VER (no subir/borrar) la base de conocimiento de
// su propio cliente — aclaración explícita del usuario en la Fase E. Trae
// documentos de TODO el grupo de external_id (resolveClientGroupIds) — así
// un documento subido para "CChC" también aparece acá cuando se navega a
// "CChC - Valle" (y viceversa), sin importar bajo cuál `clients.id`
// específico quedó guardado el archivo.
clientsRouter.get('/clients/:id/documents', async (req, res) => {
  const { id } = req.params;

  try {
    const groupIds = await resolveClientGroupIds(id);

    if (req.peithoUser!.role === 'client' && !groupIds.includes(req.peithoUser!.clientId ?? '')) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const { rows } = await pool.query(
      `select id, file_name, file_type, category, uploaded_at, (content is not null) as content_extracted
       from knowledge_base_documents
       where client_id = any($1)
       order by uploaded_at desc`,
      [groupIds]
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

  // Fase F — categoría opcional (multer entrega los campos de texto del
  // multipart en req.body igual que un form normal). Vacío/ausente = sin
  // categorizar; cualquier otro valor debe ser una de las categorías fijas.
  const rawCategory = req.body?.category;
  let category: KbCategoryKey | null = null;
  if (typeof rawCategory === 'string' && rawCategory.trim()) {
    if (!KB_CATEGORY_KEYS.includes(rawCategory as KbCategoryKey)) {
      res.status(400).json({ error: 'Categoría inválida' });
      return;
    }
    category = rawCategory as KbCategoryKey;
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
    const result = await uploadKnowledgeBaseDocument(id, fileName, req.file.buffer, category);
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
