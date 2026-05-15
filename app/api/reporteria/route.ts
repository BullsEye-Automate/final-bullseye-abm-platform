// Snapshot ejecutivo para el módulo /reporteria. Compatible con el
// range selector del dashboard.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeReporteria } from "@/lib/reporteriaQueries";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const rangeKeyParam = req.nextUrl.searchParams.get("range") ?? "this_month";
  const rangeKey: RangeKey = isValidRangeKey(rangeKeyParam)
    ? rangeKeyParam
    : "this_month";
  const range = resolveRange(rangeKey);

  const db = supabaseAdmin();
  try {
    const snapshot = await computeReporteria(db, range, rangeKey);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
