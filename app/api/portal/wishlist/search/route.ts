import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { icpToUnifiedFilters, scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, getClientExclusions, getClientIcpText } from "@/lib/wishlist";
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

// POST — { mode: "manual" | "ai", filters?, cursor? }
// Una sola búsqueda sobre la base HubSpot de BullsEye y, cuando se agota, la
// base de Lemlist del cliente. Se excluyen siempre las empresas ya pedidas,
// las de su lista de exclusión y las que ya están en su pipeline.
// ai: si no vienen filtros, la IA los genera desde el ICP y los devuelve para
//     que las páginas siguientes reutilicen los mismos (sin volver a generarlos).
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

    const pageSize = mode === "ai" ? AI_PAGE : MANUAL_PAGE;
    const result = await runUnifiedSearch(db, {
      filters,
      cursor,
      pageSize,
      exclusions,
      lemlistKey,
      catalog: taxonomy,
      lenient: mode === "ai",
    });

    let cards = result.cards;
    if (mode === "ai" && cards.length) {
      const scores = await scoreCompanies(db, {
        clientId: user.clientId,
        icpText,
        source: "unified",
        candidates: cards.map((c) => ({ key: `${c.source}:${c.key}`, name: c.name, summary: cardSummary(c) })),
      });
      cards = cards
        .map((c) => {
          const s = scores.get(`${c.source}:${c.key}`);
          return { ...c, fit_score: s?.fit_score ?? null, fit_reason: s?.fit_reason ?? null };
        })
        .sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
    }

    return NextResponse.json({
      cards: cards.map(toPublicCard),
      cursor: result.next,
      has_more: result.next.phase !== "done",
      needs_filters: result.needsFilters,
      applied_filters: mode === "ai" ? filters : undefined,
    });
  } catch (err) {
    console.error("portal wishlist search:", err);
    return NextResponse.json({ error: "No pudimos completar la búsqueda. Intenta nuevamente." }, { status: 500 });
  }
}
