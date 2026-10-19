import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { listPoolProperties, searchPool, type PoolFilter } from "@/lib/hubspotPool";
import {
  getClientOwnLemlistKey,
  getLemlistCompanyFilters,
  searchLemlistCompanies,
  type LemlistFilter,
} from "@/lib/lemlistDatabase";
import { icpToLemlistFilters, icpToPoolFilters, scoreCompanies } from "@/lib/wishlistFit";
import {
  cardSummary,
  getClientExclusions,
  getClientIcpText,
  isExcluded,
  lemlistCompanyToCard,
  poolCompanyToCard,
  type CompanyCard,
} from "@/lib/wishlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MANUAL_PAGE = 24;
const AI_PAGE = 20;

// POST — { source: "hubspot" | "lemlist", mode: "manual" | "ai", filters?, query?, page? }
// manual: filtros elegidos por el cliente; el fit se calcula después (/score).
// ai: la IA traduce el ICP a filtros, trae candidatos y los devuelve ya
//     puntuados y ordenados por fit.
// En ambos casos se excluyen las empresas ya pedidas o en el pipeline.
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const source = body?.source === "lemlist" ? "lemlist" : "hubspot";
  const mode = body?.mode === "ai" ? "ai" : "manual";
  const page = Math.max(0, Math.min(50, Number(body?.page) || 0));
  const query = typeof body?.query === "string" ? body.query.slice(0, 100) : "";
  const db = supabaseAdmin();

  const exclusions = await getClientExclusions(db, user.clientId);
  const icpText = mode === "ai" ? await getClientIcpText(db, user.clientId) : "";
  if (mode === "ai" && !icpText.trim()) {
    return NextResponse.json({ error: "Tu ICP todavía no está cargado. Complétalo en “ICP y buyer persona”." }, { status: 400 });
  }

  try {
    let cards: CompanyCard[] = [];
    let total: number | null = null;
    let appliedFilters: unknown[] = [];

    if (source === "hubspot") {
      const props = await listPoolProperties(db);
      let filters: PoolFilter[] = mode === "manual" ? sanitizePoolFilters(body?.filters) : [];
      if (mode === "ai") filters = await icpToPoolFilters(db, user.clientId, icpText, props);
      const pageSize = mode === "ai" ? AI_PAGE : MANUAL_PAGE;

      let result = await searchPool(db, {
        filters,
        query,
        excludeDomains: exclusions.domains,
        excludeNames: exclusions.names,
        limit: pageSize,
        offset: page * pageSize,
      });
      // IA: si los filtros quedaron muy estrictos, se relajan quitando los últimos
      while (mode === "ai" && page === 0 && result.total < 10 && filters.length > 0) {
        filters = filters.slice(0, -1);
        result = await searchPool(db, {
          filters,
          query,
          excludeDomains: exclusions.domains,
          excludeNames: exclusions.names,
          limit: pageSize,
          offset: 0,
        });
      }
      cards = result.companies.map((c) => poolCompanyToCard(c, props));
      total = result.total;
      appliedFilters = filters;
    } else {
      const apiKey = await getClientOwnLemlistKey(db, user.clientId);
      if (!apiKey) return NextResponse.json({ error: "Tu cuenta de Lemlist aún no está conectada." }, { status: 400 });

      let filters: LemlistFilter[] = mode === "manual" ? sanitizeLemlistFilters(body?.filters) : [];
      if (mode === "ai") {
        const defs = await getLemlistCompanyFilters(apiKey);
        if (!defs.ok) return NextResponse.json({ error: `Lemlist respondió ${defs.status}: ${defs.error}` }, { status: 502 });
        filters = await icpToLemlistFilters(db, user.clientId, icpText, defs.data);
      }
      const pageSize = mode === "ai" ? AI_PAGE : MANUAL_PAGE;
      const r = await searchLemlistCompanies(apiKey, { filters, search: query, page: page + 1, size: pageSize });
      if (!r.ok) return NextResponse.json({ error: `Lemlist respondió ${r.status}: ${r.error}` }, { status: 502 });
      cards = r.data.companies
        .map(lemlistCompanyToCard)
        .filter((c) => !isExcluded(exclusions, c.name, c.domain));
      total = r.data.total;
      appliedFilters = filters;
    }

    if (mode === "ai" && cards.length) {
      const scores = await scoreCompanies(db, {
        clientId: user.clientId,
        icpText,
        source,
        candidates: cards.map((c) => ({ key: c.key, name: c.name, summary: cardSummary(c) })),
      });
      cards = cards
        .map((c) => ({ ...c, fit_score: scores.get(c.key)?.fit_score ?? null, fit_reason: scores.get(c.key)?.fit_reason ?? null }))
        .sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
    }

    const pageSize = mode === "ai" ? AI_PAGE : MANUAL_PAGE;
    return NextResponse.json({
      cards,
      total,
      page,
      has_more: total != null ? (page + 1) * pageSize < total : cards.length > 0,
      applied_filters: appliedFilters,
    });
  } catch (err) {
    console.error("portal wishlist search:", err);
    return NextResponse.json({ error: "No pudimos completar la búsqueda. Intenta nuevamente." }, { status: 500 });
  }
}

function sanitizePoolFilters(raw: unknown): PoolFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: PoolFilter[] = [];
  for (const f of raw.slice(0, 20) as Record<string, unknown>[]) {
    const property = typeof f?.property === "string" ? f.property.slice(0, 100) : "";
    if (!property) continue;
    if (f.op === "in" && Array.isArray(f.values)) {
      const values = f.values.map(String).filter(Boolean).slice(0, 50);
      if (values.length) out.push({ property, op: "in", values });
    } else if (f.op === "range") {
      const min = f.min === "" || f.min == null ? null : Number(f.min);
      const max = f.max === "" || f.max == null ? null : Number(f.max);
      if ((min != null && Number.isFinite(min)) || (max != null && Number.isFinite(max))) {
        out.push({ property, op: "range", min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null });
      }
    } else if (f.op === "contains" && typeof f.value === "string" && f.value.trim()) {
      out.push({ property, op: "contains", value: f.value.trim().slice(0, 100) });
    }
  }
  return out;
}

function sanitizeLemlistFilters(raw: unknown): LemlistFilter[] {
  if (!Array.isArray(raw)) return [];
  return (raw.slice(0, 20) as Record<string, unknown>[])
    .map((f) => ({
      filterId: typeof f?.filterId === "string" ? f.filterId.slice(0, 100) : "",
      in: Array.isArray(f?.in) ? f.in.map(String).filter(Boolean).slice(0, 50) : [],
      out: Array.isArray(f?.out) ? f.out.map(String).filter(Boolean).slice(0, 50) : [],
    }))
    .filter((f) => f.filterId && (f.in.length || f.out.length));
}
