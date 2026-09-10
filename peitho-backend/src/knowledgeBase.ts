// Módulo 3 — Base de conocimiento por cliente (Fase C). Sube el archivo
// original a Supabase Storage (nunca al disco local del backend — mismo
// problema ya documentado con el audio: el filesystem no sobrevive un
// deploy) y extrae el texto plano para usarlo en los prompts más adelante
// (Fase D, no implementada todavía acá).

import { randomUUID } from 'crypto';
import { OfficeParser } from 'officeparser';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { getSupabaseAdminClient } from './supabaseAdmin';

const STORAGE_BUCKET = 'knowledge-base';

// Fase F — categorías fijas (ver migración 015), mismas para todos los
// clientes. `routes/clients.ts` valida contra esta lista antes de guardar.
export const KB_CATEGORY_KEYS = [
  'propuesta_valor',
  'icp_perfiles',
  'presentaciones',
  'casos_exito',
  'manejo_objeciones',
  'videos_comerciales',
  'imagenes_logos',
] as const;
export type KbCategoryKey = (typeof KB_CATEGORY_KEYS)[number];

const TEXT_EXTENSIONS = new Set(['txt', 'md']);

// Pedido explícito del usuario (10-09-2026): en la maestra de clientes, varias
// filas de `clients` a propósito comparten el mismo `external_id` cuando son
// variantes regionales de un mismo grupo para otra herramienta interna (ej.
// "CChC"/"CChC - Valle", "Nisum"/"Nisum Perú"/"Nisum Colombia" — ver
// migración 021 y la nota de Fase "Sincronización masiva de clientes" en
// CLAUDE.md). Eso es intencional para que el matching de reuniones por
// nombre exacto (metasSheet.ts) siga distinguiendo cada variante — pero para
// la Base de conocimiento deben tratarse como un solo ICP: subir un
// documento para "CChC" debe servir también para "CChC - Valle". Esta
// función resuelve el grupo completo de client_id que comparten
// external_id (o solo el propio id si no tiene external_id) — se usa tanto
// para leer el contexto de los prompts (getClientKnowledgeBaseContext) como
// para listar/autorizar documentos (routes/clients.ts).
export async function resolveClientGroupIds(clientId: string): Promise<string[]> {
  const { rows } = await pool.query(`select external_id from clients where id = $1`, [clientId]);
  const externalId = rows[0]?.external_id ?? null;
  if (!externalId) return [clientId];

  const { rows: siblings } = await pool.query(`select id from clients where external_id = $1`, [externalId]);
  return siblings.map((r) => r.id);
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

// Supabase Storage rechaza rutas con espacios u otros caracteres fuera de
// [a-zA-Z0-9.-_] con "Invalid path specified in request URL" (confirmado
// real con "OnePager Bullseye 2025.pdf") — se sanea solo la ruta de
// almacenamiento; el nombre original se sigue guardando tal cual en
// `file_name` para mostrarlo en la lista.
function sanitizeForStoragePath(fileName: string): string {
  return fileName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // tildes/acentos (ya normalizadas a marca + base)
    .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// Best-effort: si el formato no se puede procesar, devuelve null en vez de
// tirar abajo toda la subida — el archivo original igual queda guardado.
async function extractText(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = getExtension(fileName);

  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return buffer.toString('utf-8');
    }
    // officeparser detecta el formato real por los bytes del archivo (magic
    // bytes), no por la extensión — cubre pdf/docx/pptx/xlsx/odt/odp/ods/rtf
    // con una sola librería.
    const ast = await OfficeParser.parseOffice(buffer);
    return ast.toText();
  } catch (error) {
    console.error(`[knowledge-base] no se pudo extraer texto de "${fileName}"`, error);
    return null;
  }
}

export async function uploadKnowledgeBaseDocument(
  clientId: string,
  fileName: string,
  buffer: Buffer,
  category: KbCategoryKey | null
): Promise<{ id: string; fileName: string; fileType: string; contentExtracted: boolean }> {
  const supabase = getSupabaseAdminClient();
  const ext = getExtension(fileName);
  const storagePath = `${clientId}/${randomUUID()}-${sanitizeForStoragePath(fileName)}`;

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: 'application/octet-stream',
  });
  if (uploadError) {
    throw new Error(`No se pudo subir el archivo a Supabase Storage: ${uploadError.message}`);
  }

  const content = await extractText(buffer, fileName);

  const { rows } = await pool.query(
    `insert into knowledge_base_documents (client_id, file_name, file_type, storage_path, content, category)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [clientId, fileName, ext, storagePath, content, category]
  );

  return { id: rows[0].id, fileName, fileType: ext, contentExtracted: content !== null };
}

// Presupuesto de caracteres para no disparar el costo/latencia de los prompts
// de research y análisis con documentos muy largos (ej. un PDF de 90MB ya
// probado en Fase C) — mejor un extracto que forzar todo el contenido.
const MAX_CONTEXT_CHARS = 30_000;

// Fase D — concatena el texto ya extraído de los documentos de un cliente
// para usarlo como contexto en los prompts de research pre-reunión y
// análisis post-reunión. Devuelve null (no string vacío) cuando no hay
// cliente o no hay contenido extraído todavía, para que los prompts puedan
// distinguir "sin base de conocimiento" de "base de conocimiento vacía" —
// mismo patrón de "mejor vacío que dato falso" usado en el resto del código.
export async function getClientKnowledgeBaseContext(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;

  // Incluye documentos de todo el grupo (ver resolveClientGroupIds) — un
  // documento subido para "CChC" también debe informar el research/análisis
  // de una reunión resuelta contra "CChC - Valle", y viceversa.
  const groupIds = await resolveClientGroupIds(clientId);

  const { rows } = await pool.query(
    `select file_name, content
     from knowledge_base_documents
     where client_id = any($1) and content is not null
     order by uploaded_at desc`,
    [groupIds]
  );
  if (rows.length === 0) return null;

  let context = '';
  for (const row of rows) {
    const block = `--- Documento: ${row.file_name} ---\n${row.content}\n\n`;
    if (context.length + block.length > MAX_CONTEXT_CHARS) break;
    context += block;
  }

  return context.trim() || null;
}

const WEBSITE_FETCH_TIMEOUT_MS = 60_000;
// Prefijo fijo para poder encontrar y reemplazar el "documento" generado del
// sitio web en el próximo fetch (ver abajo) — sin esto, cada vez que se
// actualiza la URL se acumularía un documento viejo desactualizado además
// del nuevo.
const WEBSITE_DOCUMENT_PREFIX = 'Sitio web —';

// Pedido explícito del usuario (10-09-2026): la URL del sitio web de un
// cliente se guarda en clients.website_url, y de paso se trae su contenido
// real para sumarlo a la base de conocimiento — así el research pre-reunión
// y el análisis post-reunión lo usan automático (getClientKnowledgeBaseContext
// ya concatena todos los documentos de un cliente, este queda como uno más,
// sin tocar esos prompts). Usa la tool `web_fetch` de Claude en vez de un
// scraper propio — mismo patrón ya probado en preMeetingBrief.ts, más
// robusto que un fetch+regex casero contra sitios con JS.
export async function fetchAndStoreWebsiteContent(
  clientId: string,
  url: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: 'La URL no es válida' };
  }

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create(
      {
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1 }],
        messages: [
          {
            role: 'user',
            content: `Entra a ${url} y devolveme el contenido de texto relevante para entender esta empresa: a qué se dedica, qué productos/servicios ofrece, a qué tipo de cliente le vende (su ICP — perfil de cliente ideal), diferenciadores frente a competidores. Sin comentarios ni opiniones tuyas, sin texto de navegación/footer/legal — solo el contenido útil, en texto plano.`,
          },
        ],
      },
      { timeout: WEBSITE_FETCH_TIMEOUT_MS }
    );

    // Con la tool activa la respuesta trae varios bloques intercalados
    // (mismo patrón que preMeetingBrief.ts) — el texto final es el ÚLTIMO
    // bloque de tipo texto, no content[0].
    const textBlocks = response.content.filter((block) => block.type === 'text');
    const last = textBlocks[textBlocks.length - 1];
    const text = last && last.type === 'text' ? last.text.trim() : '';
    if (!text) {
      return { ok: false, error: 'No se pudo extraer contenido del sitio (puede estar bloqueado o vacío)' };
    }

    // Reemplaza el documento generado del sitio anterior, si existía —
    // evita acumular versiones viejas cada vez que se actualiza la URL.
    await pool.query(
      `delete from knowledge_base_documents where client_id = $1 and file_name like $2`,
      [clientId, `${WEBSITE_DOCUMENT_PREFIX}%`]
    );

    await uploadKnowledgeBaseDocument(
      clientId,
      `${WEBSITE_DOCUMENT_PREFIX} ${hostname}.txt`,
      Buffer.from(text, 'utf-8'),
      'icp_perfiles'
    );

    return { ok: true };
  } catch (error) {
    console.error(`[knowledge-base] error obteniendo contenido de ${url}`, error);
    return { ok: false, error: error instanceof Error ? error.message : 'Error obteniendo el sitio web' };
  }
}

export async function deleteKnowledgeBaseDocument(clientId: string, documentId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select storage_path from knowledge_base_documents where id = $1 and client_id = $2`,
    [documentId, clientId]
  );
  const doc = rows[0];
  if (!doc) return false;

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
  if (error) {
    // No dejamos un registro huérfano en la base si el archivo no se pudo
    // borrar del storage — mejor que quede visible y se reintente.
    throw new Error(`No se pudo borrar el archivo de Supabase Storage: ${error.message}`);
  }

  await pool.query(`delete from knowledge_base_documents where id = $1`, [documentId]);
  return true;
}
