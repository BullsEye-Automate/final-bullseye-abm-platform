import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error, count } = await db
    .from("companies")
    .select("id, company_name, status, fit_score, created_at, icp_version", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byStatus: Record<string, number> = {};
  for (const r of data ?? []) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  return NextResponse.json({
    total: count ?? 0,
    showing: data?.length ?? 0,
    by_status_in_sample: byStatus,
    rows: data ?? []
  });
}
