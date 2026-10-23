import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { listPoolProperties } from "@/lib/hubspotPool";
import { scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, excludeDetectedClients, getClientIcpText, poolCompanyToCard, type CompanyCard } from "@/lib/wishlist";
import { decodeRef } from "@/lib/unifiedSearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PER_CALL = 24;

// POST — { cards: [{ ref, name, domain, facts }] } → { scores: { ref: { fit_score, fit_reason } } }
// % de fit de los resultados de una búsqueda con filtros. Las empresas de la
// base HubSpot se releen del pool (no se confía en lo que manda el navegador).
export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const incoming = (Array.isArray(body?.cards) ? body.cards : []).slice(0, MAX_PER_CALL) as Record<string, unknown>[];
  if (!incoming.length) return NextResponse.json({ scores: {} });

  const db = supabaseAdmin();
  const icpText = await getClientIcpText(db, user.clientId);
  if (!icpText.trim()) return NextResponse.json({ scores: {}, icp_missing: true });

  const parsed = incoming
    .map((c) => ({ c, ref: String(c.ref ?? ""), id: decodeRef(c.ref) }))
    .filter((x) => x.id);
  const hsKeys = parsed.filter((x) => x.id!.source === "hubspot").map((x) => x.id!.key);
  const [{ data: hsRows }, props] = await Promise.all([
    hsKeys.length
      ? db.from("hubspot_company_pool").select("hs_id, name, domain, properties").in("hs_id", hsKeys)
      : Promise.resolve({ data: [] as { hs_id: string; name: string; domain: string | null; properties: Record<string, unknown> }[] }),
    listPoolProperties(db),
  ]);
  const hsByKey = new Map((hsRows ?? []).map((r) => [r.hs_id, r]));

  const cards: { ref: string; card: CompanyCard }[] = [];
  for (const { c, ref, id } of parsed) {
    if (id!.source === "hubspot") {
      const row = hsByKey.get(id!.key);
      if (row) cards.push({ ref, card: poolCompanyToCard(row, props) });
    } else if (typeof c.name === "string") {
      cards.push({
        ref,
        card: {
          source: "lemlist",
          key: id!.key,
          name: c.name.slice(0, 200),
          domain: typeof c.domain === "string" ? c.domain.slice(0, 200) : null,
          linkedin_url: null,
          facts: (Array.isArray(c.facts) ? c.facts : []).slice(0, 10).map((f: { label?: unknown; value?: unknown }) => ({
            label: String(f?.label ?? "").slice(0, 60),
            value: String(f?.value ?? "").slice(0, 400),
          })),
        },
      });
    }
  }

  try {
    const scores = await scoreCompanies(db, {
      clientId: user.clientId,
      icpText,
      source: "unified",
      candidates: cards.map(({ card }) => ({ key: `${card.source}:${card.key}`, name: card.name, summary: cardSummary(card) })),
    });
    const out: Record<string, unknown> = {};
    const detected: { name: string; domain: string | null }[] = [];
    for (const { ref, card } of cards) {
      const s = scores.get(`${card.source}:${card.key}`);
      if (s) out[ref] = s;
      if (s?.existing_client) detected.push({ name: card.name, domain: card.domain });
    }
    // Clientes actuales detectados → lista de exclusión (no vuelven a aparecer)
    await excludeDetectedClients(db, user.clientId, detected);
    return NextResponse.json({ scores: out });
  } catch (err) {
    console.error("portal wishlist score:", err);
    return NextResponse.json({ error: "No pudimos calcular el fit" }, { status: 500 });
  }
}
