import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_COLUMNS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_row_id, clay_pushed_at, clay_push_error, lemlist_lead_id, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, hubspot_synced_at, hubspot_sync_error, phone_enrichment_status, phone_source, phone_enriched_at, lusha_lookup_at, lemlist_lookup_at, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at";

// Filtros compartidos entre la query principal y los contadores.
//
//   pending         → pre-filter YES, sin scoring de Clay todavía.
//   approved_pending → Clay marcó action='enrich' pero todavía no se pushó
//                     a Lemlist. El SDR los aprueba en bulk desde la UI.
//   manual_review   → action='manual_review' sin veredicto humano todavía.
//   enriched        → ya empujado a Lemlist (lemlist_pushed_at NOT NULL).
//                     ANTES incluía también los enrich sin push, pero eso
//                     confundía con el bucket nuevo "Por aprobar".
//   discarded       → pre-filter NO, action='discard', status='discarded'
//                     o rechazado en manual review.
const APPROVED_PENDING_FILTER = (q: any) =>
  q
    .eq("fit_action", "enrich")
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded");

const MANUAL_REVIEW_FILTER = (q: any) =>
  q.eq("fit_action", "manual_review").is("human_decision", null);

const DISCARDED_OR =
  "prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded,human_decision.eq.rejected";

export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket") ?? "pending";
  const companyId = req.nextUrl.searchParams.get("company_id");
  const db = supabaseAdmin();

  let q: any = db.from("contacts").select(CONTACT_COLUMNS);
  if (companyId) q = q.eq("company_id", companyId);

  if (bucket === "pending") {
    q = q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending");
  } else if (bucket === "approved_pending") {
    q = APPROVED_PENDING_FILTER(q);
  } else if (bucket === "manual_review") {
    q = MANUAL_REVIEW_FILTER(q);
  } else if (bucket === "enriched") {
    q = q.not("lemlist_pushed_at", "is", null);
  } else if (bucket === "discarded") {
    q = q.or(DISCARDED_OR);
  }

  const { data, error } = await q
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pending, approvedPending, manual, enriched, discarded] = await Promise.all([
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("prefilter_result", "yes")
      .is("fit_action", null)
      .eq("status", "pending"),
    APPROVED_PENDING_FILTER(
      db.from("contacts").select("id", { count: "exact", head: true })
    ),
    MANUAL_REVIEW_FILTER(db.from("contacts").select("id", { count: "exact", head: true })),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .not("lemlist_pushed_at", "is", null),
    db.from("contacts").select("id", { count: "exact", head: true }).or(DISCARDED_OR)
  ]);

  return NextResponse.json(
    {
      contacts: data ?? [],
      counts: {
        pending: pending.count ?? 0,
        approved_pending: approvedPending.count ?? 0,
        manual_review: manual.count ?? 0,
        enriched: enriched.count ?? 0,
        discarded: discarded.count ?? 0
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
