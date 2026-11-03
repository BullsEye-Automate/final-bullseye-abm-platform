import { supabaseAdmin } from "@/lib/supabase";

// Archivos de los documentos de clientes del Centro de prospección
// (antes "assets" del artifact). Bucket privado; el navegador sube directo
// a Storage con una URL firmada (así no hay límite de 4,5 MB de Vercel) y
// los abre con un link firmado de 1 hora.

export const ASSETS_BUCKET = "centro-prospeccion";
export const ASSET_ID_RE = /^[0-9a-f]{32}$/;
const MAX_BYTES = 25 * 1024 * 1024;

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const db = supabaseAdmin();
  const { data } = await db.storage.getBucket(ASSETS_BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(ASSETS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  }
  bucketReady = true;
}

export function newAssetId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Registra el archivo y devuelve una URL firmada para subirlo.
export async function prepareUpload(p: { id?: string; fileName: string; contentType: string; size: number; by: string }) {
  if (!Number.isFinite(p.size) || p.size <= 0 || p.size > MAX_BYTES) throw new Error("El archivo debe pesar menos de 25 MB");
  await ensureBucket();
  const id = p.id && ASSET_ID_RE.test(p.id) ? p.id : newAssetId();
  const path = id;
  const db = supabaseAdmin();
  const { data, error } = await db.storage.from(ASSETS_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(error?.message || "No se pudo preparar la subida");
  const { error: e2 } = await db.from("centro_assets").upsert({
    id, storage_path: path, content_type: p.contentType || "application/octet-stream",
    size_bytes: Math.round(p.size), file_name: p.fileName.slice(0, 300), uploaded_by: p.by,
  });
  if (e2) throw new Error(e2.message);
  return { id, uploadUrl: data.signedUrl, contentType: p.contentType || "application/octet-stream", sizeBytes: Math.round(p.size) };
}

// Sube un archivo desde el servidor (lo usa la importación del respaldo).
export async function putAsset(p: { id: string; fileName: string; contentType: string; bytes: Buffer; by: string }) {
  if (!ASSET_ID_RE.test(p.id)) throw new Error("Id de archivo inválido");
  await ensureBucket();
  const db = supabaseAdmin();
  const { error } = await db.storage.from(ASSETS_BUCKET).upload(p.id, p.bytes, { contentType: p.contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { error: e2 } = await db.from("centro_assets").upsert({
    id: p.id, storage_path: p.id, content_type: p.contentType, size_bytes: p.bytes.length,
    file_name: p.fileName.slice(0, 300), uploaded_by: p.by,
  });
  if (e2) throw new Error(e2.message);
}

export async function signedAssetUrl(id: string, seconds = 3600): Promise<string | null> {
  if (!ASSET_ID_RE.test(id)) return null;
  const db = supabaseAdmin();
  const { data: row } = await db.from("centro_assets").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!row) return null;
  const { data, error } = await db.storage.from(ASSETS_BUCKET).createSignedUrl(row.storage_path as string, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteAsset(id: string) {
  if (!ASSET_ID_RE.test(id)) throw new Error("Id de archivo inválido");
  const db = supabaseAdmin();
  const { data: row } = await db.from("centro_assets").select("storage_path").eq("id", id).maybeSingle();
  if (!row) return;
  await db.storage.from(ASSETS_BUCKET).remove([row.storage_path as string]);
  await db.from("centro_assets").delete().eq("id", id);
}
