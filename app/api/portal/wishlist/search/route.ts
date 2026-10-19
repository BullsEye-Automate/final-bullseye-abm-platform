import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { icpToUnifiedFilters, scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, getClientExclusions, getClientIcpText, type CompanyCard } from "@/lib/wishlist";
import {
  buildFilterCatalog,
  parseCursor,
  runUnifiedSearch,
  sanitizeUnifiedFilters,
  toPublicCard,
} from "@/lib/unifiedSearch";
import { hasAnyFilter, type UnifiedFilters } from "@/lib/unifiedFilterDefs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MANUAL_PAGE = 24;
const AI_PAGE = 20;
// Modo IA: solo se muestran empresas con buen fit. Cada llamada procesa UNA
// tanda (búsqueda + fit) para no pasar el límite de 60 s de Vercel; el
// navegador pide más tandas solo hasta juntar suficientes empresas buenas.
const AI_MIN_FIT = 60;

// POST — { mode: "manual" | "ai", filters?, cursor? }
// Una sola búsqueda sobre la base HubSpot de BullsEye y, cuando se agota, la
// base de Lemlist del cliente. Se excluyen siempre las empresas ya pedidas,
// las de su lista de exclusión y las que ya están en su pipeline.
// manual: sin fit automático; el cliente lo pide por empresa (/score).
// ai: si no vienen filtros, la IA los genera desde el ICP y los devuelve para
//     que las páginas siguientes reutilicen los mismos. Todo se puntúa y solo
//     se devuelven empresas con fit >= AI_MIN_FIT, ordenadas de mayor a menor.
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const mode = body?.mode === "ai" ? "ai" : "manual";
  const cursor = parseCursor(body?.cursor);
  let filters: UnifiedFilters = sanitizeUnifiedFilters(body?.filters);
  const db = supabaseAdmin();

  try {
    const [exclusions, lemlistKey] = await Promise.all([
      getClientExclusions(db, user.clientId),
      getClientOwnLemlistKey(db, user.clientId),
    ]);
    const taxonomy = { industryTaxonomy: (lemlistKey ? "lemlist" : "hubspot") as "lemlist" | "hubspot" };

    let icpText = "";
    if (mode === "ai") {
      icpText = await getClientIcpText(db, user.clientId);
      if (!icpText.trim()) {
        return NextResponse.json({ error: "Tu ICP todavía no está cargado. Complétalo en “ICP y buyer persona”." }, { status: 400 });
      }
      if (!hasAnyFilter(filters)) {
        const catalog = await buildFilterCatalog(db, lemlistKey);
        filters = await icpToUnifiedFilters(db, user.clientId, icpText, catalog);
      }
    }

    const base = { filters, pageSize: mode === "ai" ? AI_PAGE : MANUAL_PAGE, exclusions, lemlistKey, catalog: taxonomy, lenient: mode === "ai" };

    // Búsqueda con filtros: sin fit automático (el cliente lo pide por empresa)
    if (mode === "manual") {
      const result = await runUnifiedSearch(db, { ...base, cursor });
      return NextResponse.json({
        cards: result.cards.map(toPublicCard),
        cursor: result.next,
        has_more: result.next.phase !== "done",
        needs_filters: result.needsFilters,
      });
    }

    // Recomendadas por IA: se puntúa todo y se devuelven solo las de buen fit
    let next = cursor;
    let needsFilters = false;
    let lowFitHidden = 0;
    let cards: (CompanyCard & { fit_score: number; fit_reason: string })[] = [];
    for (let round = 0; round < 1 && next.phase !== "done"; round++) {
      const result = await runUnifiedSearch(db, { ...base, cursor: next });
      next = result.next;
      needsFilters = needsFilters || result.needsFilters;
      if (!result.cards.length) continue;
      const scores = await scoreCompanies(db, {
        clientId: user.clientId,
        icpText,
        source: "unified",
        candidates: result.cards.map((c) => ({ key: `${c.source}:${c.key}`, name: c.name, summary: cardSummary(c) })),
      });
      for (const c of result.cards) {
        const sc = scores.get(`${c.source}:${c.key}`);
        if (sc && sc.fit_score >= AI_MIN_FIT) cards.push({ ...c, fit_score: sc.fit_score, fit_reason: sc.fit_reason });
        else lowFitHidden++;
      }
    }
    cards = cards.sort((a, b) => b.fit_score - a.fit_score);

    return NextResponse.json({
      cards: cards.map(toPublicCard),
      cursor: next,
      has_more: next.phase !== "done",
      needs_filters: needsFilters,
      applied_filters: filters,
      low_fit_hidden: lowFitHidden,
      min_fit: AI_MIN_FIT,
    });
  } catch (err) {
    console.error("portal wishlist search:", err);
    return NextResponse.json({ error: "No pudimos completar la búsqueda. Intenta nuevamente." }, { status: 500 });
  }
}
