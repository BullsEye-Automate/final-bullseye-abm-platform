import { promises as fs } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectProgress, findCatalogEntry, htmlTitle, type ProgressConfig } from "../catalog";

// De dónde sale el Entrenamiento cliente de un cliente:
//   1) el HTML subido desde Configurar (sdr_academies.html), si existe;
//   2) si no, la academia del repo (content/entrenamiento/, ver catalog.ts).

export type TrainingMeta = {
  title: string;
  origin: "subido" | "proyecto";
  sourceUrl: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  tracking: boolean;                 // se puede registrar el avance por vuelta
  hasProjectVersion: boolean;        // hay academia en el repo (al quitar la subida vuelve a esa)
  progress: ProgressConfig | null;
};

type Client = { id: string; name: string; slug: string };

async function readRepoFile(file: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "content", "entrenamiento", file), "utf8");
}

export async function loadUpload(db: SupabaseClient, clientId: string) {
  const { data } = await db
    .from("sdr_academies")
    .select("html, title, source_url, uploaded_by, uploaded_at")
    .eq("client_id", clientId)
    .maybeSingle();
  return data?.html ? (data as { html: string; title: string | null; source_url: string | null; uploaded_by: string | null; uploaded_at: string | null }) : null;
}

export async function getTraining(db: SupabaseClient, client: Client, withHtml: boolean): Promise<{ meta: TrainingMeta; html: string | null } | null> {
  const entry = findCatalogEntry(client);
  const upload = await loadUpload(db, client.id);
  if (upload) {
    const progress = detectProgress(upload.html);
    return {
      meta: {
        title: upload.title || htmlTitle(upload.html) || `Entrenamiento ${client.name}`,
        origin: "subido",
        sourceUrl: upload.source_url,
        uploadedBy: upload.uploaded_by,
        uploadedAt: upload.uploaded_at,
        tracking: progress !== null,
        hasProjectVersion: entry !== null,
        progress,
      },
      html: withHtml ? upload.html : null,
    };
  }
  if (!entry) return null;
  return {
    meta: {
      title: entry.title,
      origin: "proyecto",
      sourceUrl: entry.sourceUrl,
      uploadedBy: null,
      uploadedAt: null,
      tracking: true,
      hasProjectVersion: true,
      progress: entry.progress,
    },
    html: withHtml ? await readRepoFile(entry.file) : null,
  };
}

// Clientes activos con y sin entrenamiento (para la alerta).
export async function loadCoverage(db: SupabaseClient) {
  const [{ data: clients }, { data: uploads }] = await Promise.all([
    db.from("clients").select("id, name, slug, is_active").order("name"),
    db.from("sdr_academies").select("client_id").not("html", "is", null),
  ]);
  const uploaded = new Set(((uploads ?? []) as { client_id: string }[]).map((u) => u.client_id));
  return ((clients ?? []) as (Client & { is_active: boolean | null })[])
    .filter((c) => c.is_active !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      origin: uploaded.has(c.id) ? ("subido" as const) : findCatalogEntry(c) ? ("proyecto" as const) : null,
    }));
}
