import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { listPoolProperties } from "@/lib/hubspotPool";
import { scoreCompanies } from "@/lib/wishlistFit";
import { cardSummary, getClientIcpText, poolCompanyToCard, type CompanyCard } from "@/lib/wishlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PER_CALL = 24;

// POST — { source, cards: [{ key, name, domain, facts }] } → { scores: { key: { fit_score, fit_reason } } }
// Calcula el % de fit de los resultados de una búsqueda manual. Para HubSpot
// los datos se releen del pool (no se confía en lo que manda el navegador).
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const source = body?.source === "lemlist" ? "lemlist" : "hubspot";
  const incoming = (Array.isArray(body?.cards) ? body.cards : []).slice(0, MAX_PER_CALL) as Partial<CompanyCard>[];
  if (!incoming.length) return NextResponse.json({ scores: {} });

  const db = supabaseAdmin();
  const icpText = await getClientIcpText(db, user.clientId);
  if (!icpText.trim()) return NextResponse.json({ scores: {}, icp_missing: true });

  let cards: CompanyCard[];
  if (source === "hubspot") {
    const keys = incoming.map((c) => String(c.key ?? "")).filter(Boolean);
    const [{ data }, props] = await Promise.all([
      db.from("hubspot_company_pool").select("hs_id, name, domain, properties").in("hs_id", keys),
      listPoolProperties(db),
    ]);
    cards = (data ?? []).map((c) => poolCompanyToCard(c, props));
  } else {
    cards = incoming
      .filter((c) => typeof c.key === "string" && typeof c.name === "string")
      .map((c) => ({
        source: "lemlist" as const,
        key: String(c.key).slice(0, 200),
        name: String(c.name).slice(0, 200),
        domain: typeof c.domain === "string" ? c.domain.slice(0, 200) : null,
        linkedin_url: null,
        facts: (Array.isArray(c.facts) ? c.facts : [])
          .slice(0, 8)
          .map((f) => ({ label: String(f?.label ?? "").slice(0, 60), value: String(f?.value ?? "").slice(0, 400) })),
      }));
  }

  try {
    const scores = await scoreCompanies(db, {
      clientId: user.clientId,
      icpText,
      source,
      candidates: cards.map((c) => ({ key: c.key, name: c.name, summary: cardSummary(c) })),
    });
    return NextResponse.json({ scores: Object.fromEntries(scores) });
  } catch (err) {
    console.error("portal wishlist score:", err);
    return NextResponse.json({ error: "No pudimos calcular el fit" }, { status: 500 });
  }
}
