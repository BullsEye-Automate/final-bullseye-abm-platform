// Módulo 3 — Base de conocimiento por cliente (Fase C). Sube el archivo
// original a Supabase Storage (nunca al disco local del backend — mismo
// problema ya documentado con el audio: el filesystem no sobrevive un
// deploy) y extrae el texto plano para usarlo en los prompts más adelante
// (Fase D, no implementada todavía acá).

import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { OfficeParser } from 'officeparser';
import { pool } from './db';

const STORAGE_BUCKET = 'knowledge-base';

// Validado dentro de la función (no a nivel de módulo) para no romper el
// resto del backend si todavía no se configuró — mismo patrón que
// createOAuthClient() en google.ts.
function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno (ver .env.example)'
    );
  }
  return createClient(url, serviceRoleKey);
}

const TEXT_EXTENSIONS = new Set(['txt', 'md']);

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
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
  const storagePath = `${clientId}/${randomUUID()}-${fileName}`;

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
