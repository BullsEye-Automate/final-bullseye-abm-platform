// Módulo 3 — Base de conocimiento por cliente (Fase C). Sube el archivo
// original a Supabase Storage (nunca al disco local del backend — mismo
// problema ya documentado con el audio: el filesystem no sobrevive un
// deploy) y extrae el texto plano para usarlo en los prompts más adelante
// (Fase D, no implementada todavía acá).

import { randomUUID } from 'crypto';
import { OfficeParser } from 'officeparser';
import { pool } from './db';
import { getSupabaseAdminClient } from './supabaseAdmin';

const STORAGE_BUCKET = 'knowledge-base';

const TEXT_EXTENSIONS = new Set(['txt', 'md']);

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
  buffer: Buffer
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
    `insert into knowledge_base_documents (client_id, file_name, file_type, storage_path, content)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [clientId, fileName, ext, storagePath, content]
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

  const { rows } = await pool.query(
    `select file_name, content
     from knowledge_base_documents
     where client_id = $1 and content is not null
     order by uploaded_at desc`,
    [clientId]
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
