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
import { canRelaxFor } from "@/lib/centroProspeccion/recoAmpliar";
import { auditCompany, loadAuditContext, withAuditFact, type AuditResult } from "@/lib/centroProspeccion/recoAudit";

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

// Orden en que se sueltan los filtros que salen del ICP cuando la búsqueda se
// agota (nov-2026: con "palabra clave" muy específica —"SENCE", "maquiladora"—
// Vigatec, Grupo Tress, CChC y Simplex se quedaban con 0–8 recomendaciones). El
// fit con el ICP (≥ MIN_FIT) sigue decidiendo cuáles quedan: ampliar la búsqueda
// no baja la calidad, solo revisa más empresas. País, industria y tamaño no se sueltan.
// APAGADO por defecto desde el 25-nov-2026 (pedido de BullsEye): solo se usa con
// los clientes que lo aprobaron formalmente (lib/centroProspeccion/recoAmpliar.ts).
const RELAX_ORDER = ["keyword", "revenues", "markets", "companyTypes", "description"] as const;
export function relaxFilters(f: UnifiedFilters): UnifiedFilters | null {
  for (const k of RELAX_ORDER) {
    const v = (f as Record<string, unknown>)[k];
    if (v == null || (Array.isArray(v) ? !v.length : !String(v).trim())) continue;
    const next = { ...f } as Record<string, unknown>;
    delete next[k];
    return next as UnifiedFilters;
  }
  return null;
}

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
    filters = sanitizeUnifiedFilters(state.filters);
    cursor = parseCursor(state.cursor);
    if (state.exhausted) {
      // Se agotó la búsqueda con estos filtros: se amplía quitando un filtro a la
      // vez y se parte de nuevo (las ya evaluadas salen del caché de fit, sin costo).
      // Solo si el cliente aprobó ampliar la búsqueda; si no, se busca solo con el ICP
      const wider = (await canRelaxFor(clientId)) ? relaxFilters(filters) : null;
      if (!wider) return { cards: [] as ReturnType<typeof toRecoCard>[], exhausted: true, applied_filters: state.filters, scanned: 0, low_fit_hidden: 0, existing_clients_hidden: 0 };
      filters = wider;
      cursor = { ...FIRST_CURSOR };
    }
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
  const fresh = result.cards.filter((c) => !knownSet.has(`${c.source}:${c.key}`));

  // Revisión antes de evaluar (lib/centroProspeccion/recoAudit.ts): lo que
  // coincide con seguridad con algo ya trabajado, excluido o recomendado no se
  // evalúa ni se muestra; lo dudoso se muestra con una nota para revisar.
  const audit = await loadAuditContext(db, clientId).catch((e) => {
    console.warn("[reco] revisión:", (e as Error).message);
    return null;
  });
  const verdict = new Map<string, AuditResult>();
  const blocked: RecoRow[] = [];
  const candidates: typeof fresh = [];
  for (const c of fresh) {
    const v = audit ? auditCompany(audit, c.name, c.domain) : { level: "ok" as const, reasons: [] };
    if (v.level === "block") {
      blocked.push({ source: c.source, source_ref: c.key, company_name: c.name, domain: c.domain, linkedin_url: c.linkedin_url, facts: withAuditFact(c.facts, v), fit_score: 0, fit_reason: `Oculta: ${v.reasons.join(" · ")}`.slice(0, 600) });
      continue;
    }
    verdict.set(`${c.source}:${c.key}`, v);
    audit?.add(c.name, c.domain, "repetida en la misma tanda");
    candidates.push(c);
  }
  if (blocked.length) {
    const { error } = await db.from("client_recommendations").upsert(
      blocked.map((g) => ({ ...g, client_id: clientId, icp_hash: hash, status: "excluded", updated_at: new Date().toISOString() })),
      { onConflict: "client_id,source,source_ref", ignoreDuplicates: true }
    );
    if (error) console.warn("[reco] ocultas:", error.message);
  }

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
        facts: withAuditFact(c.facts, verdict.get(`${c.source}:${c.key}`) ?? { level: "ok", reasons: [] }),
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
