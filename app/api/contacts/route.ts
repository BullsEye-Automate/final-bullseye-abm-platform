import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_COLUMNS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_row_id, clay_pushed_at, clay_push_error, lemlist_lead_id, hubspot_contact_id, created_at, updated_at";

export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket") ?? "pending";
  const companyId = req.nextUrl.searchParams.get("company_id");
  const db = supabaseAdmin();

  let q = db.from("contacts").select(CONTACT_COLUMNS);
  if (companyId) q = q.eq("company_id", companyId);

  // Buckets:
  //   pending       → pre-filter yes, sin scoring aún (fit_action IS NULL, status pending)
  //   manual_review → fit_action = manual_review (score 5-7)
  //   enriched      → status IN (enriched, contacted, replied)
  //   discarded     → pre-filter no, fit_action = discard, o status = discarded
  if (bucket === "pending") {
    q = q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending");
  } else if (bucket === "manual_review") {
    q = q.eq("fit_action", "manual_review");
  } else if (bucket === "enriched") {
    q = q.in("status", ["enriched", "contacted", "replied"]);
  } else if (bucket === "discarded") {
    q = q.or("prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded");
  }

  const { data, error } = await q
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pending, manual, enriched, discarded] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending"),
    db.from("contacts").select("id", { count: "exact", head: true }).eq("fit_action", "manual_review"),
    db.from("contacts").select("id", { count: "exact", head: true }).in("status", ["enriched", "contacted", "replied"]),
    db.from("contacts").select("id", { count: "exact", head: true }).or("prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded")
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
