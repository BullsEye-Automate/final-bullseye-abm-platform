import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { attachFit, facetCounts, icpPersonaTargets, sanitizeFilters, searchCompanies } from "@/lib/acti/search";
import { loadQuota } from "@/lib/acti/quota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATION_HINT = "La búsqueda de empresas se está habilitando. Vuelve a intentarlo en unos minutos.";

// POST { filters, page, facets } → empresas de la base de BullsEye con su fit
// (motor actual) y perfiles disponibles (solo tipos de cargo, sin nombres).
export async function POST(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => ({}));
  const filters = sanitizeFilters(body?.filters);
  const page = Math.max(0, Math.min(200, Number(body?.page) || 0));
  const db = supabaseAdmin();
  try {
    const clientId = s.user.clientId;
    const [{ cards, total }, facets, targets, quota, { data: saved }] = await Promise.all([
      searchCompanies(db, clientId, filters, page),
      body?.facets ? facetCounts(db, clientId, filters) : Promise.resolve(null),
      icpPersonaTargets(db, clientId),
      loadQuota(db, clientId, s.member, s.plan, s.config.params),
      db.from("acti_saved_companies").select("hs_id").eq("client_id", clientId),
    ]);
    const { icpMissing } = await attachFit(db, clientId, cards, true);
    const savedSet = new Set(((saved ?? []) as { hs_id: string }[]).map((x) => x.hs_id));
    return NextResponse.json({
      cards: cards.map((c) => ({ ...c, saved: savedSet.has(c.hsId) })),
      total,
      page,
      facets,
      targets,
      quota,
      icpMissing,
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("acti buscar:", msg);
    return NextResponse.json({ error: /acti_pool|function|does not exist/i.test(msg) ? MIGRATION_HINT : "No se pudo buscar" }, { status: 500 });
  }
}
