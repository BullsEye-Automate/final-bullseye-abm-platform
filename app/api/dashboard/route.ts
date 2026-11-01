import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { computeAllClientsDashboard, computeClientDashboard } from "@/lib/prospectingDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dashboard de prospección (wishlist): ?range=this_month&client_id=<id | __all__>
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "this_month";
  const raw = url.searchParams.get("client_id");
  const clientId = !raw || raw === "__all__" ? null : raw;
  const key: RangeKey = isValidRangeKey(rangeParam) && rangeParam !== "custom" ? rangeParam : "this_month";
  const range = resolveRange(key);
  const db = supabaseAdmin();
  try {
    const data = clientId
      ? await computeClientDashboard(db, clientId, range.start, range.end)
      : await computeAllClientsDashboard(db, range.start, range.end);
    return NextResponse.json({ ...data, range: { key, label: range.label } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}
