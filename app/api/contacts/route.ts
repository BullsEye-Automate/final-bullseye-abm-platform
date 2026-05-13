import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_COLUMNS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_row_id, clay_pushed_at, clay_push_error, lemlist_lead_id, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, hubspot_synced_at, hubspot_sync_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at";

// Filtros compartidos entre la query principal y los contadores.
// manual_review excluye contactos con veredicto humano (esos pasan a enriched o discarded).
// enriched incluye fit_action='enrich' aunque el status no haya transicionado todavía.
const MANUAL_REVIEW_FILTER = (q: any) =>
  q.eq("fit_action", "manual_review").is("human_decision", null);

const ENRICHED_OR = "status.in.(enriched,contacted,replied),fit_action.eq.enrich";

const DISCARDED_OR =
  "prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded,human_decision.eq.rejected";

export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket") ?? "pending";
  const companyId = req.nextUrl.searchParams.get("company_id");
  const db = supabaseAdmin();

  let q = db.from("contacts").select(CONTACT_COLUMNS);
  if (companyId) q = q.eq("company_id", companyId);

  // Buckets:
  //   pending       → pre-filter yes, sin scoring aún (fit_action IS NULL, status pending)
  //   manual_review → fit_action = manual_review AND sin veredicto humano (score 5-7)
  //   enriched      → status IN (enriched, contacted, replied) o fit_action = enrich
  //   discarded     → pre-filter no, fit_action = discard, status = discarded, o rechazado manual
  if (bucket === "pending") {
    q = q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending");
  } else if (bucket === "manual_review") {
    q = MANUAL_REVIEW_FILTER(q);
  } else if (bucket === "enriched") {
    q = q.or(ENRICHED_OR);
  } else if (bucket === "discarded") {
    q = q.or(DISCARDED_OR);
  }

  const { data, error } = await q
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pending, manual, enriched, discarded] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending"),
    MANUAL_REVIEW_FILTER(db.from("contacts").select("id", { count: "exact", head: true })),
    db.from("contacts").select("id", { count: "exact", head: true }).or(ENRICHED_OR),
    db.from("contacts").select("id", { count: "exact", head: true }).or(DISCARDED_OR)
  ]);

  return NextResponse.json(
    {
      contacts: data ?? [],
      counts: {
        pending: pending.count ?? 0,
        manual_review: manual.count ?? 0,
        enriched: enriched.count ?? 0,
        discarded: discarded.count ?? 0
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
