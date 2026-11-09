import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { icpHash } from "@/lib/wishlistFit";
import { getClientExclusions, getClientIcpText, isExcluded } from "@/lib/wishlist";
import { MIN_FIT, RecoInputError, runRecommendationRound, toRecoCard as toCard, type RecoRow as Row } from "@/lib/wishlistRecommendations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recomendaciones IA persistentes (solo equipo BullsEye, en Empresas).
// Cada empresa evaluada con buen fit queda guardada en client_recommendations
// como "pending" hasta que el cliente la agregue u omita: no desaparece al
// recargar y no se vuelve a pagar su evaluación. El avance de la búsqueda
// (filtros generados desde el ICP + cursor) queda en client_reco_state, así
// cada "Generar más" sigue donde quedó en vez de partir de cero.

// El cálculo de cada tanda está en lib/wishlistRecommendations.ts (lo
// comparte el cron del Centro de prospección).
const MAX_PENDING = 1000;

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
    return NextResponse.json(await runRecommendationRound(db, user.clientId, { reset: body?.reset === true }));
  } catch (err) {
    if (err instanceof RecoInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("portal recommendations:", err);
    return NextResponse.json({ error: "No pudimos completar esta tanda. Intenta nuevamente." }, { status: 500 });
  }
}
