import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, research_summary, research_sources, competitor_match, status, reject_reason, approved_by, approved_at, icp_version, clay_pushed_at, clay_push_error, created_at, updated_at"
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "approved"),
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "rejected")
  ]);

  return NextResponse.json(
    {
      companies: data ?? [],
      counts: {
        pending: pendingRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
