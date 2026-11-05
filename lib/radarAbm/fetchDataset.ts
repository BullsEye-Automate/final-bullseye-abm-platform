import type { RadarDataset, RadarMeeting } from "./types";

// Navegador: descarga el informe guardado en Supabase Storage (gzip) desde el
// link firmado que entrega la API y le repone avisos / mapeo (solo vista interna).
// Feedback del cliente en vivo (id de reunión → campos) sobre el informe guardado
export function applyFeedback(ds: RadarDataset | null, feedback?: Record<string, Partial<RadarMeeting>> | null): RadarDataset | null {
  if (!ds || !feedback || !Object.keys(feedback).length) return ds;
  const meetings = ds.client.meetings.map((m) => (feedback[String(m.id)] ? { ...m, ...feedback[String(m.id)] } : m));
  return { ...ds, client: { ...ds.client, meetings } };
}

export async function resolveDataset(j: {
  dataset?: RadarDataset | null;
  datasetUrl?: string;
  datasetExtra?: { warnings?: string[]; mapping?: RadarDataset["mapping"] };
  feedback?: Record<string, Partial<RadarMeeting>> | null;
}): Promise<RadarDataset | null> {
  if (j.dataset || !j.datasetUrl) return applyFeedback(j.dataset ?? null, j.feedback);
  const r = await fetch(j.datasetUrl, { cache: "no-store" });
  if (!r.ok || !r.body) throw new Error(`No se pudo descargar el informe (${r.status})`);
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede abrir el informe: actualízalo (Chrome, Edge, Firefox o Safari recientes).");
  const ds = (await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RadarDataset;
  return applyFeedback({ ...ds, ...(j.datasetExtra?.warnings ? { warnings: j.datasetExtra.warnings } : {}), ...(j.datasetExtra?.mapping ? { mapping: j.datasetExtra.mapping } : {}) }, j.feedback);
}
