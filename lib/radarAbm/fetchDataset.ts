import type { RadarDataset } from "./types";

// Navegador: descarga el informe guardado en Supabase Storage (gzip) desde el
// link firmado que entrega la API y le repone avisos / mapeo (solo vista interna).
export async function resolveDataset(j: {
  dataset?: RadarDataset | null;
  datasetUrl?: string;
  datasetExtra?: { warnings?: string[]; mapping?: RadarDataset["mapping"] };
}): Promise<RadarDataset | null> {
  if (j.dataset || !j.datasetUrl) return j.dataset ?? null;
  const r = await fetch(j.datasetUrl, { cache: "no-store" });
  if (!r.ok || !r.body) throw new Error(`No se pudo descargar el informe (${r.status})`);
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede abrir el informe: actualízalo (Chrome, Edge, Firefox o Safari recientes).");
  const ds = (await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RadarDataset;
  return { ...ds, ...(j.datasetExtra?.warnings ? { warnings: j.datasetExtra.warnings } : {}), ...(j.datasetExtra?.mapping ? { mapping: j.datasetExtra.mapping } : {}) };
}
