import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { icpHash } from "@/lib/wishlistFit";
import { getClientExclusions, getClientIcpText, type CompanyCard } from "@/lib/wishlist";
import { parseCursor, runUnifiedSearch, sanitizeUnifiedFilters, toPublicCard } from "@/lib/unifiedSearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 24;

// POST — { filters, cursor? } búsqueda con filtros ("Buscar empresas").
// Una sola búsqueda sobre la base HubSpot de BullsEye y, cuando se agota, la
// base de Lemlist del cliente. Se excluyen siempre las empresas ya pedidas,
// las de su lista de exclusión y las que ya están en su pipeline.
// Sin fit automático: el cliente lo pide por empresa (/score); solo se
// muestran gratis los fits que ya estaban calculados.
// Las recomendaciones IA van por /api/portal/wishlist/recommendations.
export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const cursor = parseCursor(body?.cursor);
  const filters = sanitizeUnifiedFilters(body?.filters);
  const db = supabaseAdmin();

  try {
    const [exclusions, lemlistKey] = await Promise.all([
      getClientExclusions(db, user.clientId),
      getClientOwnLemlistKey(db, user.clientId),
    ]);
    const result = await runUnifiedSearch(db, {
      filters,
      cursor,
      pageSize: PAGE_SIZE,
      exclusions,
      lemlistKey,
      catalog: { industryTaxonomy: lemlistKey ? "lemlist" : "hubspot" },
    });
    // Fit ya calculado antes (recomendaciones, "Ver fit"): se muestra sin volver a cobrar IA
    const cached = await cachedFits(db, user.clientId, result.cards);
    return NextResponse.json({
      cards: result.cards.map((c) => ({ ...toPublicCard(c), ...cached.get(`${c.source}:${c.key}`) })),
      cursor: result.next,
      has_more: result.next.phase !== "done",
      needs_filters: result.needsFilters,
    });
  } catch (err) {
    console.error("portal wishlist search:", err);
    return NextResponse.json({ error: "No pudimos completar la búsqueda. Intenta nuevamente." }, { status: 500 });
  }
}

// Fits en caché (company_fit_scores) para el ICP vigente; sin llamadas a la IA
async function cachedFits(db: SupabaseClient, clientId: string, cards: CompanyCard[]) {
  const out = new Map<string, { fit_score: number; fit_reason: string }>();
  if (!cards.length) return out;
  const icpText = await getClientIcpText(db, clientId);
  if (!icpText.trim()) return out;
  const { data } = await db
    .from("company_fit_scores")
    .select("source_key, fit_score, fit_reason")
    .eq("client_id", clientId)
    .eq("source", "unified")
    .eq("icp_hash", icpHash(icpText))
    .in("source_key", cards.map((c) => `${c.source}:${c.key}`));
  for (const r of data ?? []) {
    // Clientes actuales ya quedaron en la lista de exclusión
    if (!r.fit_reason.startsWith("[CLIENTE_ACTUAL]")) out.set(r.source_key, { fit_score: r.fit_score, fit_reason: r.fit_reason });
  }
  return out;
}
