import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls
// Query params:
//   range=this_week|last_week|this_month|last_month|this_semester|last_semester|this_year|last_year|all
//   response=<category>  (filtra por customer_response_category)
//   owner=<hubspot_owner_id>
//   limit=<n>  (default 200, max 500)
//
// Devuelve lista DESC por call_timestamp con joins ligeros a contacto/empresa
// más un bloque agregado para KPIs del header de la página.

import { resolveRange, isValidRangeKey, RANGE_LABELS, type RangeKey } from "@/lib/dashboardRanges";

const ALL_KEY = "all";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "this_month";
  const response = url.searchParams.get("response");
  const owner = url.searchParams.get("owner");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);

  let start: Date | null = null;
  let end: Date | null = null;
  let label = "Todas";
  if (rangeParam !== ALL_KEY) {
    const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
    const r = resolveRange(key);
    start = r.start;
    end = r.end;
    label = RANGE_LABELS[key];
  }

  const db = supabaseAdmin();
  let q = db
    .from("calls")
    .select(
      "id, hubspot_call_id, call_timestamp, direction, duration_ms, " +
        "disposition_label, status, owner_name, hubspot_owner_id, " +
        "customer_response_category, customer_response_label, customer_response_summary, " +
        "sdr_score_overall, sdr_score_opening, sdr_score_discovery, sdr_score_objection, sdr_score_next_step, " +
        "analyzed_at, analysis_error, recommended_next_step, has_transcription, " +
        "contact:contacts(id, first_name, last_name, job_title, linkedin_url, " +
        "  company:companies(id, company_name)), " +
        "company:companies(id, company_name)"
    )
    .order("call_timestamp", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (start) q = q.gte("call_timestamp", start.toISOString());
  if (end) q = q.lte("call_timestamp", end.toISOString());
  if (response) q = q.eq("customer_response_category", response);
  if (owner) q = q.eq("hubspot_owner_id", owner);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // KPIs del rango
  let kpiQ = db.from("calls").select("id, duration_ms, sdr_score_overall, customer_response_category, analyzed_at", {
    count: "exact"
  });
  if (start) kpiQ = kpiQ.gte("call_timestamp", start.toISOString());
  if (end) kpiQ = kpiQ.lte("call_timestamp", end.toISOString());
  if (owner) kpiQ = kpiQ.eq("hubspot_owner_id", owner);
  const { data: allRows } = await kpiQ;

  const total = allRows?.length ?? 0;
  const analyzedRows = (allRows ?? []).filter((r) => r.analyzed_at);
  const totalAnalyzed = analyzedRows.length;
  const pendingAnalysis = (allRows ?? []).filter((r) => !r.analyzed_at).length;

  // Huérfanas globales (no por rango): calls con hubspot_contact_id pero
  // sin contact_id en Supabase. Se vinculan via /api/calls/link-orphans.
  const { count: orphanCount } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .is("contact_id", null)
    .not("hubspot_contact_id", "is", null);
  const avgDuration =
    total > 0
      ? Math.round(
          ((allRows ?? []).reduce((s, r) => s + (Number(r.duration_ms) || 0), 0) / total) / 1000
        )
      : 0;
  const avgScore =
    totalAnalyzed > 0
      ? Math.round(
          (analyzedRows.reduce((s, r) => s + (Number(r.sdr_score_overall) || 0), 0) / totalAnalyzed) *
            10
        ) / 10
      : null;
  const interested = (allRows ?? []).filter((r) => r.customer_response_category === "interested").length;
  const callbacks = (allRows ?? []).filter((r) => r.customer_response_category === "callback_requested").length;

  return NextResponse.json({
    range: { key: rangeParam, label, start: start?.toISOString() ?? null, end: end?.toISOString() ?? null },
    kpis: {
      total_calls: total,
      total_analyzed: totalAnalyzed,
      pending_analysis: pendingAnalysis,
      orphan_calls: orphanCount ?? 0,
      avg_duration_sec: avgDuration,
      avg_sdr_score: avgScore,
      interested_count: interested,
      callbacks_count: callbacks,
      interested_rate: total > 0 ? Math.round((interested / total) * 1000) / 10 : null
    },
    calls: data ?? []
  });
}
