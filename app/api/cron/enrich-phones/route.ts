import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enrichContactPhone } from "@/lib/phoneEnrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron endpoint — corrido cada 10 min por GitHub Actions
// (.github/workflows/enrich-phones.yml). En Vercel Hobby no hay cron
// nativo, por eso el dispatcher es Actions.
//
// Estrategia: para cada cron tick procesamos hasta MAX contactos. Si hay
// más quedan para el próximo tick. El throttle evita pegarle a Lemlist/
// Lusha en burst y entrar en rate limit.
//
// Candidatos a enriquecer:
//   - human_decision='approved' (entraron a Lemlist)
//   - phone IS NULL
//   - phone_enrichment_status IS NULL OR ('lemlist_pending' AND
//     lemlist_pushed_at < now() - 5 min)
//   - lemlist_pushed_at IS NOT NULL (esperamos un piso de 5 min para que
//     Lemlist tenga chance de enrich)

const MAX_PER_RUN = 5;
const MIN_LEMLIST_WAIT_MINUTES = 5;

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  const got =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (expected && got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const minLemlistTs = new Date(
    Date.now() - MIN_LEMLIST_WAIT_MINUTES * 60 * 1000
  ).toISOString();

  // Pickeamos hasta MAX_PER_RUN, priorizando los con fit_score más alto.
  const { data: rows, error } = await db
    .from("contacts")
    .select(
      "id, fit_score, phone_enrichment_status, lemlist_pushed_at, lemlist_lead_id"
    )
    .eq("human_decision", "approved")
    .is("phone", null)
    .not("lemlist_pushed_at", "is", null)
    .lte("lemlist_pushed_at", minLemlistTs)
    .or("phone_enrichment_status.is.null,phone_enrichment_status.eq.lemlist_pending,phone_enrichment_status.eq.requested")
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("lemlist_pushed_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidates = rows ?? [];
  const results: Array<{ id: string; ok: boolean; status: string; phone: string | null }> = [];
  for (const row of candidates) {
    const r = await enrichContactPhone(db, row.id);
    results.push({
      id: row.id,
      ok: r.ok,
      status: r.status,
      phone: r.phone
    });
  }

  return NextResponse.json({
    processed: candidates.length,
    results,
    next_run_min: MAX_PER_RUN,
    note:
      candidates.length === MAX_PER_RUN
        ? "Hit MAX_PER_RUN cap; remaining candidates will be picked up next tick."
        : "All eligible candidates processed."
  });
}
