import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { icpHash, icpToUnifiedFilters, scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, excludeDetectedClients, getClientExclusions, getClientIcpText } from "@/lib/wishlist";
import {
  buildFilterCatalog,
  encodeRef,
  FIRST_CURSOR,
  parseCursor,
  runUnifiedSearch,
  sanitizeUnifiedFilters,
} from "@/lib/unifiedSearch";
import type { UnifiedFilters } from "@/lib/unifiedFilterDefs";

// Una tanda de Recomendaciones IA (búsqueda unificada + fit) de un cliente.
// Es el mismo cálculo de POST /api/portal/wishlist/recommendations, movido
// aquí sin cambios para que también lo use el cron del Centro de
// prospección (/api/cron/centro-recomendaciones, domingos).
// Las de buen fit quedan en client_recommendations como "pending"; el avance
// (filtros desde el ICP + cursor) en client_reco_state.

// Tamaño fijo por tanda (el cursor de Lemlist pagina por número de página)
export const ROUND_SIZE = 30;
export const MIN_FIT = 60;

export type RecoRow = {
  source: "hubspot" | "lemlist";
  source_ref: string;
  company_name: string;
  domain: string | null;
  linkedin_url: string | null;
  facts: { label: string; value: string }[];
  fit_score: number;
  fit_reason: string;
};

export const toRecoCard = (r: RecoRow) => ({
  ref: encodeRef(r.source, r.source_ref),
  name: r.company_name,
  domain: r.domain,
  linkedin_url: r.linkedin_url,
  facts: r.facts ?? [],
  fit_score: r.fit_score,
  fit_reason: r.fit_reason,
});

// Error del dato de entrada (ej. ICP no cargado): la API responde 400 con el mensaje
export class RecoInputError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runRecommendationRound(db: any, clientId: string, opts: { reset?: boolean } = {}) {
  const icpText = await getClientIcpText(db, clientId);
  if (!icpText.trim()) {
    throw new RecoInputError("Tu ICP todavía no está cargado. Complétalo en “ICP y buyer persona”.");
  }
  const hash = icpHash(icpText);

  const [exclusions, lemlistKey, { data: state }] = await Promise.all([
    getClientExclusions(db, clientId),
    getClientOwnLemlistKey(db, clientId),
    db.from("client_reco_state").select("icp_hash, filters, cursor, exhausted").eq("client_id", clientId).maybeSingle(),
  ]);

  // Filtros y cursor: se reutilizan salvo que el ICP haya cambiado o se pida empezar de nuevo
  let filters: UnifiedFilters;
  let cursor = { ...FIRST_CURSOR };
  if (state && state.icp_hash === hash && opts.reset !== true) {
    if (state.exhausted) return { cards: [] as ReturnType<typeof toRecoCard>[], exhausted: true, applied_filters: state.filters, scanned: 0, low_fit_hidden: 0, existing_clients_hidden: 0 };
    filters = sanitizeUnifiedFilters(state.filters);
    cursor = parseCursor(state.cursor);
  } else {
    const catalog = await buildFilterCatalog(db, lemlistKey);
    filters = await icpToUnifiedFilters(db, clientId, icpText, catalog);
  }

  const result = await runUnifiedSearch(db, {
    filters,
    cursor,
    pageSize: ROUND_SIZE,
    exclusions,
    lemlistKey,
    catalog: { industryTaxonomy: lemlistKey ? "lemlist" : "hubspot" },
    lenient: true,
  });
  const next = result.next;

  // Las que ya están pendientes (de una vuelta anterior) no se vuelven a contar.
  // Una que se agregó y luego se quitó de la wishlist vuelve como pendiente
  // (su fit sale del caché, sin costo).
  const refs = result.cards.map((c) => c.key);
  const { data: known } = refs.length
    ? await db.from("client_recommendations").select("source, source_ref").eq("client_id", clientId).eq("icp_hash", hash).eq("status", "pending").in("source_ref", refs)
    : { data: [] };
  const knownSet = new Set(((known ?? []) as { source: string; source_ref: string }[]).map((k) => `${k.source}:${k.source_ref}`));
  const candidates = result.cards.filter((c) => !knownSet.has(`${c.source}:${c.key}`));

  const scores = await scoreCompanies(db, {
    clientId,
    icpText,
    source: "unified",
    candidates: candidates.map((c) => ({ key: `${c.source}:${c.key}`, name: c.name, summary: cardSummary(c) })),
  });

  const detected: { name: string; domain: string | null }[] = [];
  const good: RecoRow[] = [];
  let lowFit = 0;
  for (const c of candidates) {
    const sc = scores.get(`${c.source}:${c.key}`);
    if (sc?.existing_client) detected.push({ name: c.name, domain: c.domain });
    else if (sc && sc.fit_score >= MIN_FIT) {
      good.push({
        source: c.source,
        source_ref: c.key,
        company_name: c.name,
        domain: c.domain,
        linkedin_url: c.linkedin_url,
        facts: c.facts,
        fit_score: sc.fit_score,
        fit_reason: sc.fit_reason,
      });
    } else lowFit++;
  }
  await excludeDetectedClients(db, clientId, detected);

  if (good.length) {
    const { error } = await db
      .from("client_recommendations")
      .upsert(
        good.map((g) => ({ ...g, client_id: clientId, icp_hash: hash, status: "pending", updated_at: new Date().toISOString() })),
        { onConflict: "client_id,source,source_ref" }
      );
    if (error) throw new Error(error.message);
  }

  const exhausted = next.phase === "done";
  await db.from("client_reco_state").upsert({
    client_id: clientId,
    icp_hash: hash,
    filters,
    cursor: next,
    exhausted,
    updated_at: new Date().toISOString(),
  });

  return {
    cards: good.sort((a, b) => b.fit_score - a.fit_score).map(toRecoCard),
    exhausted,
    applied_filters: filters,
    scanned: candidates.length,
    low_fit_hidden: lowFit,
    existing_clients_hidden: detected.length,
    needs_filters: result.needsFilters,
  };
}
