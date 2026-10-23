import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { listPoolProperties, normalizeDomain } from "@/lib/hubspotPool";
import { markRecommendation, poolCompanyToCard, type CompanyCard } from "@/lib/wishlist";
import { decodeRef } from "@/lib/unifiedSearch";

export const dynamic = "force-dynamic";

// GET — empresas que el cliente omitió (sin la fuente)
export async function GET(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_omitted_companies")
    .select("id, company_name, domain, linkedin_url, fit_score, fit_reason, omitted_by_email, created_at")
    .eq("client_id", user.clientId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// POST — { ref, card?, fit_score?, fit_reason? } omite una empresa de los
// resultados: no vuelve a aparecer en búsquedas ni recomendaciones.
export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  const body = await req.json().catch(() => null);
  const id = decodeRef(body?.ref);
  if (!id) return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
  const db = supabaseAdmin();

  let card: CompanyCard | null = null;
  if (id.source === "hubspot") {
    const [{ data: row }, props] = await Promise.all([
      db.from("hubspot_company_pool").select("hs_id, name, domain, properties").eq("hs_id", id.key).maybeSingle(),
      listPoolProperties(db),
    ]);
    if (row) card = poolCompanyToCard(row, props);
  } else {
    const c = (body?.card ?? {}) as Record<string, unknown>;
    const name = str(c.name, 200);
    if (name) {
      card = {
        source: "lemlist",
        key: id.key,
        name,
        domain: normalizeDomain(str(c.domain, 300)),
        linkedin_url: str(c.linkedin_url, 300),
        facts: (Array.isArray(c.facts) ? c.facts : []).slice(0, 10).map((f: { label?: unknown; value?: unknown }) => ({
          label: String(f?.label ?? "").slice(0, 60),
          value: String(f?.value ?? "").slice(0, 400),
        })),
      };
    }
  }
  if (!card) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  const fitScore = typeof body?.fit_score === "number" ? Math.max(0, Math.min(100, Math.round(body.fit_score))) : null;
  const { error } = await db.from("client_omitted_companies").insert({
    client_id: user.clientId,
    company_name: card.name,
    domain: card.domain,
    linkedin_url: card.linkedin_url,
    source: id.source,
    source_ref: id.key,
    fit_score: fitScore,
    fit_reason: str(body?.fit_reason, 600),
    snapshot: { facts: card.facts },
    omitted_by: user.portalUserId,
    omitted_by_email: user.email,
  });
  // Ya estaba omitida: se considera éxito
  if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  await markRecommendation(db, user.clientId, id.source, id.key, "omitted");
  return NextResponse.json({ ok: true });
}
