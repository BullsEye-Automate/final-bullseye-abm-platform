import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, RANGE_LABELS, type RangeKey } from "@/lib/dashboardRanges";
import { CUSTOMER_RESPONSE_LABELS, type CustomerResponseCategory } from "@/lib/callAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/report?range=this_month
// Devuelve agregaciones para el módulo de reportería:
//   - Distribución de respuestas del cliente
//   - Ranking de SDRs por score promedio
//   - Sub-scores promedio agregados (apertura, descubrimiento, objeción, next_step)
//   - Top áreas de mejora (agregando "area" de sdr_improvements)
//   - Time series diario: calls + score promedio
type Row = {
  id: string;
  call_timestamp: string | null;
  hubspot_owner_id: string | null;
  owner_name: string | null;
  duration_ms: number | null;
  customer_response_category: CustomerResponseCategory | null;
  sdr_score_overall: number | null;
  sdr_score_opening: number | null;
  sdr_score_discovery: number | null;
  sdr_score_objection: number | null;
  sdr_score_next_step: number | null;
  sdr_improvements: Array<{ area?: string; suggestion?: string }> | null;
  analyzed_at: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "this_month";
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();
  const { data: rowsRaw, error } = await db
    .from("calls")
    .select(
      "id, call_timestamp, hubspot_owner_id, owner_name, duration_ms, " +
        "customer_response_category, sdr_score_overall, sdr_score_opening, " +
        "sdr_score_discovery, sdr_score_objection, sdr_score_next_step, " +
        "sdr_improvements, analyzed_at"
    )
    .gte("call_timestamp", range.start.toISOString())
    .lte("call_timestamp", range.end.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (rowsRaw ?? []) as unknown as Row[];

  // 1. Distribución de respuestas
  const responseCounts: Record<string, number> = {};
  for (const r of rows) {
    const k = r.customer_response_category ?? "(no analizado)";
    responseCounts[k] = (responseCounts[k] ?? 0) + 1;
  }
  const responseDistribution = Object.entries(responseCounts)
    .map(([key, count]) => ({
      key,
      label:
        key === "(no analizado)"
          ? "Sin analizar"
          : CUSTOMER_RESPONSE_LABELS[key as CustomerResponseCategory] ?? key,
      count
    }))
    .sort((a, b) => b.count - a.count);

  // 2. Ranking SDRs
  const sdrAgg = new Map<
    string,
    { name: string; calls: number; analyzed: number; score_sum: number; interested: number }
  >();
  for (const r of rows) {
    const id = r.hubspot_owner_id ?? "unknown";
    const name = r.owner_name ?? "(sin owner)";
    const entry = sdrAgg.get(id) ?? { name, calls: 0, analyzed: 0, score_sum: 0, interested: 0 };
    entry.calls++;
    if (r.analyzed_at && r.sdr_score_overall != null) {
      entry.analyzed++;
      entry.score_sum += Number(r.sdr_score_overall);
    }
    if (r.customer_response_category === "interested") entry.interested++;
    sdrAgg.set(id, entry);
  }
  const sdrRanking = Array.from(sdrAgg.entries())
    .map(([id, v]) => ({
      hubspot_owner_id: id,
      name: v.name,
      calls: v.calls,
      analyzed: v.analyzed,
      avg_score: v.analyzed > 0 ? Math.round((v.score_sum / v.analyzed) * 10) / 10 : null,
      interested: v.interested,
      interested_rate: v.calls > 0 ? Math.round((v.interested / v.calls) * 1000) / 10 : null
    }))
    .sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1));

  // 3. Sub-scores promedio
  const analyzed = rows.filter((r) => r.analyzed_at && r.sdr_score_overall != null);
  const subScores = {
    opening:
      analyzed.length > 0
        ? Math.round(
            (analyzed.reduce((s, r) => s + Number(r.sdr_score_opening ?? 0), 0) / analyzed.length) *
              10
          ) / 10
        : null,
    discovery:
      analyzed.length > 0
        ? Math.round(
            (analyzed.reduce((s, r) => s + Number(r.sdr_score_discovery ?? 0), 0) / analyzed.length) *
              10
          ) / 10
        : null,
    objection_handling:
      analyzed.length > 0
        ? Math.round(
            (analyzed.reduce((s, r) => s + Number(r.sdr_score_objection ?? 0), 0) / analyzed.length) *
              10
          ) / 10
        : null,
    next_step:
      analyzed.length > 0
        ? Math.round(
            (analyzed.reduce((s, r) => s + Number(r.sdr_score_next_step ?? 0), 0) / analyzed.length) *
              10
          ) / 10
        : null
  };

  // 4. Top áreas de mejora (frecuencia agregada del campo "area")
  const areaCounts = new Map<string, number>();
  for (const r of rows) {
    const imps = r.sdr_improvements ?? [];
    for (const i of imps) {
      const a = (i?.area ?? "").toString().trim();
      if (!a) continue;
      areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
    }
  }
  const topImprovementAreas = Array.from(areaCounts.entries())
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 5. Time series diario (calls + avg score)
  const byDay = new Map<string, { calls: number; score_sum: number; analyzed: number }>();
  for (const r of rows) {
    if (!r.call_timestamp) continue;
    const day = r.call_timestamp.slice(0, 10);
    const entry = byDay.get(day) ?? { calls: 0, score_sum: 0, analyzed: 0 };
    entry.calls++;
    if (r.analyzed_at && r.sdr_score_overall != null) {
      entry.analyzed++;
      entry.score_sum += Number(r.sdr_score_overall);
    }
    byDay.set(day, entry);
  }
  const activity = Array.from(byDay.entries())
    .map(([date, v]) => ({
      date,
      calls: v.calls,
      avg_score: v.analyzed > 0 ? Math.round((v.score_sum / v.analyzed) * 10) / 10 : null
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    range: {
      key,
      label: RANGE_LABELS[key],
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    totals: {
      calls: rows.length,
      analyzed: analyzed.length,
      avg_score:
        analyzed.length > 0
          ? Math.round(
              (analyzed.reduce((s, r) => s + Number(r.sdr_score_overall ?? 0), 0) / analyzed.length) *
                10
            ) / 10
          : null
    },
    sub_scores: subScores,
    response_distribution: responseDistribution,
    sdr_ranking: sdrRanking,
    top_improvement_areas: topImprovementAreas,
    activity
  });
}
