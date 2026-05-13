import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidRangeKey, resolveRange, type RangeKey } from "@/lib/dashboardRanges";
import { computeDashboard } from "@/lib/dashboardQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/dashboard?range=this_month
// Default: this_month si el query param no viene o es inválido.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawRange = url.searchParams.get("range") ?? "this_month";
  const rangeKey: RangeKey = isValidRangeKey(rawRange) ? rawRange : "this_month";
  const range = resolveRange(rangeKey);

  const db = supabaseAdmin();
  try {
    const data = await computeDashboard(db, range, rangeKey);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
