import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { getClientOwnLemlistKey } from "@/lib/lemlistDatabase";
import { icpHash, icpToUnifiedFilters, scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, excludeDetectedClients, getClientExclusions, getClientIcpText, isExcluded } from "@/lib/wishlist";
import {
  buildFilterCatalog,
  encodeRef,
  FIRST_CURSOR,
  parseCursor,
  runUnifiedSearch,
  sanitizeUnifiedFilters,
} from "@/lib/unifiedSearch";
import type { UnifiedFilters } from "@/lib/unifiedFilterDefs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recomendaciones IA persistentes (solo equipo BullsEye, en Empresas).
// Cada empresa evaluada con buen fit queda guardada en client_recommendations
// como "pending" hasta que el cliente la agregue u omita: no desaparece al
// recargar y no se vuelve a pagar su evaluación. El avance de la búsqueda
// (filtros generados desde el ICP + cursor) queda en client_reco_state, así
// cada "Generar más" sigue donde quedó en vez de partir de cero.

// Tamaño fijo por tanda (el cursor de Lemlist pagina por número de página)
const ROUND_SIZE = 30;
const MIN_FIT = 60;
const MAX_PENDING = 1000;

type Row = {
  source: "hubspot" | "lemlist";
  source_ref: string;
  company_name: string;
  domain: string | null;
  linkedin_url: string | null;
  facts: { label: string; value: string }[];
  fit_score: number;
  fit_reason: string;
};

const toCard = (r: Row) => ({
  ref: encodeRef(r.source, r.source_ref),
  name: r.company_name,
  domain: r.domain,
  linkedin_url: r.linkedin_url,
  facts: r.facts ?? [],
  fit_score: r.fit_score,
  fit_reason: r.fit_reason,
});

// GET — recomendaciones pendientes (ICP vigente), de mayor a menor fit
export async function GET(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  // Solo el equipo BullsEye genera y ve recomendaciones IA; al cliente se le
  // PROPONEN empresas (Propuestas de BullsEye en su portal)
  if (!user.isOperator) return NextResponse.json({ error: "Las recomendaciones las prepara el equipo de BullsEye" }, { status: 403 });
  const db = supabaseAdmin();

  const icpText = await getClientIcpText(db, user.clientId);
  if (!icpText.trim()) return NextResponse.json({ items: [], state: null, icp_missing: true });
  const hash = icpHash(icpText);

  const [{ data, error }, { data: state }, exclusions] = await Promise.all([
    db
      .from("client_recommendations")
      .select("source, source_ref, company_name, domain, linkedin_url, facts, fit_score, fit_reason")
      .eq("client_id", user.clientId)
      .eq("status", "pending")
      .eq("icp_hash", hash)
      .order("fit_score", { ascending: false })
      .limit(MAX_PENDING),
    db.from("client_reco_state").select("icp_hash, filters, exhausted").eq("client_id", user.clientId).maybeSingle(),
    getClientExclusions(db, user.clientId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Si después se agregaron a la lista de exclusión (o ya se pidieron) no se muestran
  const items = ((data ?? []) as Row[]).filter((r) => !isExcluded(exclusions, r.company_name, r.domain)).map(toCard);
  const current = state && state.icp_hash === hash;
  return NextResponse.json({
    items,
    applied_filters: current ? state.filters : null,
    exhausted: current ? state.exhausted : false,
    min_fit: MIN_FIT,
  });
}

// POST — { reset? } procesa UNA tanda (búsqueda + fit) y guarda las de buen
// fit. El navegador repite tandas hasta llegar a la cantidad que eligió el
// cliente (cada llamada cabe en el límite de 60 s de Vercel).
export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  // Solo el equipo BullsEye genera y ve recomendaciones IA; al cliente se le
  // PROPONEN empresas (Propuestas de BullsEye en su portal)
  if (!user.isOperator) return NextResponse.json({ error: "Las recomendaciones las prepara el equipo de BullsEye" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const db = supabaseAdmin();

  try {
    const icpText = await getClientIcpText(db, user.clientId);
    if (!icpText.trim()) {
      return NextResponse.json({ error: "Tu ICP todavía no está cargado. Complétalo en “ICP y buyer persona”." }, { status: 400 });
    }
    const hash = icpHash(icpText);

    const [exclusions, lemlistKey, { data: state }] = await Promise.all([
      getClientExclusions(db, user.clientId),
      getClientOwnLemlistKey(db, user.clientId),
      db.from("client_reco_state").select("icp_hash, filters, cursor, exhausted").eq("client_id", user.clientId).maybeSingle(),
    ]);

    // Filtros y cursor: se reutilizan salvo que el ICP haya cambiado o el cliente pida empezar de nuevo
    let filters: UnifiedFilters;
    let cursor = { ...FIRST_CURSOR };
    if (state && state.icp_hash === hash && body?.reset !== true) {
      if (state.exhausted) return NextResponse.json({ cards: [], exhausted: true, applied_filters: state.filters, scanned: 0, low_fit_hidden: 0, existing_clients_hidden: 0 });
      filters = sanitizeUnifiedFilters(state.filters);
      cursor = parseCursor(state.cursor);
    } else {
      const catalog = await buildFilterCatalog(db, lemlistKey);
      filters = await icpToUnifiedFilters(db, user.clientId, icpText, catalog);
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
      ? await db.from("client_recommendations").select("source, source_ref").eq("client_id", user.clientId).eq("icp_hash", hash).eq("status", "pending").in("source_ref", refs)
      : { data: [] };
    const knownSet = new Set((known ?? []).map((k) => `${k.source}:${k.source_ref}`));
    const candidates = result.cards.filter((c) => !knownSet.has(`${c.source}:${c.key}`));

    const scores = await scoreCompanies(db, {
      clientId: user.clientId,
      icpText,
      source: "unified",
      candidates: candidates.map((c) => ({ key: `${c.source}:${c.key}`, name: c.name, summary: cardSummary(c) })),
    });

    const detected: { name: string; domain: string | null }[] = [];
    const good: Row[] = [];
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
    await excludeDetectedClients(db, user.clientId, detected);

    if (good.length) {
      const { error } = await db
        .from("client_recommendations")
        .upsert(
          good.map((g) => ({ ...g, client_id: user.clientId, icp_hash: hash, status: "pending", updated_at: new Date().toISOString() })),
          { onConflict: "client_id,source,source_ref" }
        );
      if (error) throw new Error(error.message);
    }

    const exhausted = next.phase === "done";
    await db.from("client_reco_state").upsert({
      client_id: user.clientId,
      icp_hash: hash,
      filters,
      cursor: next,
      exhausted,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({
      cards: good.sort((a, b) => b.fit_score - a.fit_score).map(toCard),
      exhausted,
      applied_filters: filters,
      scanned: candidates.length,
      low_fit_hidden: lowFit,
      existing_clients_hidden: detected.length,
      needs_filters: result.needsFilters,
    });
  } catch (err) {
    console.error("portal recommendations:", err);
    return NextResponse.json({ error: "No pudimos completar esta tanda. Intenta nuevamente." }, { status: 500 });
  }
}
