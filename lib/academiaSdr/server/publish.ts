import type { SupabaseClient } from "@supabase/supabase-js";
import { compactName, detectProgress, htmlTitle } from "../catalog";
import { getTraining, loadCoverage } from "./source";

// Publicación del Entrenamiento cliente. La usan la subida manual
// (PUT /api/academia-sdr) y el conector MCP de Claude
// (/api/centro/mcp/[secret], herramientas entrenamiento_*): el skill
// "academia-sdr-bullseye" publica desde el proyecto de Claude del cliente
// cada vez que crea o actualiza la academia, sin archivos de por medio.

export const MAX_HTML = 4_000_000;

export type PublishedClient = { id: string; name: string; slug: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cliente por id, slug o nombre (compactado: sin espacios, tildes ni
// símbolos). Si no hay uno solo que calce, devuelve los candidatos.
export async function findClient(db: SupabaseClient, query: string): Promise<{ client: PublishedClient | null; candidates: string[] }> {
  const q = (query ?? "").trim();
  if (!q) return { client: null, candidates: [] };
  const { data } = await db.from("clients").select("id, name, slug, is_active");
  const all = ((data ?? []) as (PublishedClient & { is_active: boolean | null })[]).filter((c) => c.is_active !== false);
  if (UUID_RE.test(q)) {
    const c = all.find((x) => x.id === q);
    return { client: c ?? null, candidates: [] };
  }
  const k = compactName(q);
  const exact = all.filter((c) => compactName(c.name) === k || compactName(c.slug) === k);
  if (exact.length === 1) return { client: exact[0], candidates: [] };
  const partial = (exact.length ? exact : all).filter(
    (c) => compactName(c.name).startsWith(k) || k.startsWith(compactName(c.name)) || compactName(c.slug).startsWith(k)
  );
  if (partial.length === 1) return { client: partial[0], candidates: [] };
  return { client: null, candidates: (partial.length ? partial : exact).map((c) => c.name) };
}

export function validateHtml(html: unknown): string | null {
  if (typeof html !== "string" || !html) return "Falta el HTML";
  if (html.length > MAX_HTML) return "El HTML pesa más de 4 MB";
  if (!/<html|<!doctype|<body|<section/i.test(html)) return "El contenido no parece una página HTML";
  return null;
}

export async function publishTraining(
  db: SupabaseClient,
  client: PublishedClient,
  opts: { html: string; sourceUrl?: string | null; by: string | null }
) {
  const sourceUrl = opts.sourceUrl && /^https:\/\/claude\.ai\//.test(opts.sourceUrl.trim()) ? opts.sourceUrl.trim() : null;
  const now = new Date().toISOString();
  const { error } = await db.from("sdr_academies").upsert(
    { client_id: client.id, html: opts.html, title: htmlTitle(opts.html), source_url: sourceUrl, uploaded_by: opts.by, uploaded_at: now, updated_at: now },
    { onConflict: "client_id" }
  );
  if (error) throw new Error(error.message);
  return {
    title: htmlTitle(opts.html),
    tracking: detectProgress(opts.html) !== null,
    publishedAt: now,
  };
}

// Lo que ve Claude al listar: qué clientes tienen entrenamiento y de dónde.
export async function trainingOverview(db: SupabaseClient) {
  return (await loadCoverage(db)).map((c) => ({ cliente: c.name, slug: c.slug, entrenamiento: c.origin ?? "sin entrenamiento" }));
}

export async function currentTrainingHtml(db: SupabaseClient, client: PublishedClient) {
  const t = await getTraining(db, client, true);
  return t ? { title: t.meta.title, origin: t.meta.origin, uploadedAt: t.meta.uploadedAt, html: t.html } : null;
}
