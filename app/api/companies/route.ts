import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status   = req.nextUrl.searchParams.get("status")    ?? "pending";
  const clientId = req.nextUrl.searchParams.get("client_id") || null;
  const db = supabaseAdmin();

  // "client_review" es un tab especial que agrupa client_approved + client_rejected
  const isClientReview = status === "client_review";

  let q = db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, research_summary, research_sources, competitor_match, status, reject_reason, approved_by, approved_at, icp_version, clay_pushed_at, clay_push_error, created_at, updated_at"
    );

  if (isClientReview) {
    q = q.in("status", ["client_approved", "client_rejected"]);
  } else {
    q = q.eq("status", status);
  }
  if (clientId) q = q.eq("client_id", clientId);

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  function countFor(s: string) {
    let cq = db.from("companies").select("id", { count: "exact", head: true }).eq("status", s);
    if (clientId) cq = cq.eq("client_id", clientId);
    return cq;
  }

  function countForIn(statuses: string[]) {
    let cq = db.from("companies").select("id", { count: "exact", head: true }).in("status", statuses);
    if (clientId) cq = cq.eq("client_id", clientId);
    return cq;
  }

  const [pendingRes, approvedRes, rejectedRes, clientReviewRes] = await Promise.all([
    countFor("pending"),
    countFor("approved"),
    countFor("rejected"),
    countForIn(["client_approved", "client_rejected"]),
  ]);

  return NextResponse.json(
    {
      companies: data ?? [],
      counts: {
        pending:       pendingRes.count       ?? 0,
        approved:      approvedRes.count      ?? 0,
        rejected:      rejectedRes.count      ?? 0,
        client_review: clientReviewRes.count  ?? 0,
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
