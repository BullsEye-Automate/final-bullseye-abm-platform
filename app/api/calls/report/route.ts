import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, RANGE_LABELS, type RangeKey } from "@/lib/dashboardRanges";
import {
  CUSTOMER_RESPONSE_LABELS,
  PICKUP_CATEGORIES,
  NO_PICKUP_CATEGORIES,
  type CustomerResponseCategory
} from "@/lib/callAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/report?range=this_month&owner=<hubspot_owner_id>
type Row = {
  id: string;
  call_timestamp: string | null;
  hubspot_owner_id: string | null;
  owner_name: string | null;
  duration_ms: number | null;
  customer_response_category: CustomerResponseCategory | null;
  contact_id: string | null;
  company_id: string | null;
  sdr_score_overall: number | null;
  sdr_score_opening: number | null;
  sdr_score_discovery: number | null;
  sdr_score_objection: number | null;
  sdr_score_next_step: number | null;
  sdr_improvements: Array<{ area?: string; suggestion?: string; example_quote?: string | null }> | null;
  analyzed_at: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "this_month";
  const owner = url.searchParams.get("owner");
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();
  let q = db
    .from("calls")
    .select(
      "id, call_timestamp, hubspot_owner_id, owner_name, duration_ms, " +
        "customer_response_category, contact_id, company_id, " +
        "sdr_score_overall, sdr_score_opening, " +
        "sdr_score_discovery, sdr_score_objection, sdr_score_next_step, " +
        "sdr_improvements, analyzed_at"
    )
    .gte("call_timestamp", range.start.toISOString())
    .lte("call_timestamp", range.end.toISOString());
  if (owner) q = q.eq("hubspot_owner_id", owner);

  const { data: rowsRaw, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (rowsRaw ?? []) as unknown as Row[];

  // ---- Totals con contactos y empresas únicas ----
  const uniqueContacts = new Set(
    rows.filter((r) => r.contact_id).map((r) => r.contact_id as string)
  );
  const uniqueCompanies = new Set(
    rows.filter((r) => r.company_id).map((r) => r.company_id as string)
  );

  // ---- Tasas de pickup ----
  const analyzed = rows.filter((r) => r.analyzed_at && r.sdr_score_overall != null);
  const pickupCalls = analyzed.filter(
    (r) => r.customer_response_category && PICKUP_CATEGORIES.has(r.customer_response_category)
  );
  const noPickupCalls = analyzed.filter(
    (r) => r.customer_response_category && NO_PICKUP_CATEGORIES.has(r.customer_response_category)
  );
  const pickupDenominator = pickupCalls.length + noPickupCalls.length;
  const pickupRateCalls =
    pickupDenominator > 0
      ? Math.round((pickupCalls.length / pickupDenominator) * 1000) / 10
      : null;

  const contactsWorked = new Set<string>();
  const contactsWithPickup = new Set<string>();
  for (const r of analyzed) {
    if (!r.contact_id || !r.customer_response_category) continue;
    if (
      PICKUP_CATEGORIES.has(r.customer_response_category) ||
      NO_PICKUP_CATEGORIES.has(r.customer_response_category)
    ) {
      contactsWorked.add(r.contact_id);
      if (PICKUP_CATEGORIES.has(r.customer_response_category)) {
        contactsWithPickup.add(r.contact_id);
      }
    }
  }
  const pickupRateContacts =
    contactsWorked.size > 0
      ? Math.round((contactsWithPickup.size / contactsWorked.size) * 1000) / 10
      : null;

  // ---- 1. Distribución de respuestas (con call_ids para drilldown) ----
  const responseMap = new Map<string, { count: number; call_ids: string[] }>();
  for (const r of rows) {
    const k = r.customer_response_category ?? "(no analizado)";
    const entry = responseMap.get(k) ?? { count: 0, call_ids: [] };
    entry.count++;
    entry.call_ids.push(r.id);
    responseMap.set(k, entry);
  }
  const responseDistribution = Array.from(responseMap.entries())
    .map(([key, v]) => ({
      key,
      label:
        key === "(no analizado)"
          ? "Sin analizar"
          : CUSTOMER_RESPONSE_LABELS[key as CustomerResponseCategory] ?? key,
      count: v.count,
      call_ids: v.call_ids
    }))
    .sort((a, b) => b.count - a.count);

  // ---- 2. Ranking SDRs ----
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

  // ---- 3. Sub-scores promedio + worst calls por dimensión ----
  const SUB_SCORE_AREA_KEYWORDS: Record<string, string[]> = {
    opening: ["apertura", "opening", "introduc"],
    discovery: ["descubr", "discovery", "pregunt", "necesid"],
    objection_handling: ["objec"],
    next_step: ["próximo paso", "proximo paso", "next step", "cierre", "compromiso"]
  };
  function findImprovementForDim(
    imps: Row["sdr_improvements"],
    dim: keyof typeof SUB_SCORE_AREA_KEYWORDS
  ): { suggestion: string | null; quote: string | null } {
    if (!imps || imps.length === 0) return { suggestion: null, quote: null };
    const keys = SUB_SCORE_AREA_KEYWORDS[dim];
    const matched = imps.find((i) => {
      const a = (i?.area ?? "").toLowerCase();
      return keys.some((k) => a.includes(k));
    });
    const pick = matched ?? imps[0];
    return {
      suggestion: pick?.suggestion?.toString().trim() || null,
      quote: pick?.example_quote ? String(pick.example_quote).trim().slice(0, 400) : null
    };
  }

  function dimAverage(field: keyof Row): number | null {
    if (analyzed.length === 0) return null;
    return (
      Math.round(
        (analyzed.reduce((s, r) => s + Number(r[field] ?? 0), 0) / analyzed.length) * 10
      ) / 10
    );
  }

  function worstForDim(
    field: keyof Row,
    dim: keyof typeof SUB_SCORE_AREA_KEYWORDS
  ): Array<{ call_id: string; score: number; suggestion: string | null; quote: string | null }> {
    return analyzed
      .filter((r) => r[field] != null)
      .sort((a, b) => Number(a[field]) - Number(b[field]))
      .slice(0, 5)
      .map((r) => {
        const imp = findImprovementForDim(r.sdr_improvements, dim);
        return {
          call_id: r.id,
          score: Number(r[field]),
          suggestion: imp.suggestion,
          quote: imp.quote
        };
      });
  }

  const subScores = {
    opening: {
      value: dimAverage("sdr_score_opening"),
      worst_calls: worstForDim("sdr_score_opening", "opening")
    },
    discovery: {
      value: dimAverage("sdr_score_discovery"),
      worst_calls: worstForDim("sdr_score_discovery", "discovery")
    },
    objection_handling: {
      value: dimAverage("sdr_score_objection"),
      worst_calls: worstForDim("sdr_score_objection", "objection_handling")
    },
    next_step: {
      value: dimAverage("sdr_score_next_step"),
      worst_calls: worstForDim("sdr_score_next_step", "next_step")
    }
  };

  // ---- 4. Top áreas de mejora (con call_ids + agregación de sugerencias) ----
  // Para cada área, guardamos: count, lista de call_ids, sugerencias agregadas
  // (deduped y top 5), y la cita textual más representativa de cada call.
  type AreaAgg = {
    count: number;
    call_ids: string[];
    suggestions: string[];
    quotes: Array<{ call_id: string; quote: string }>;
  };
  const areaMap = new Map<string, AreaAgg>();
  for (const r of rows) {
    const imps = r.sdr_improvements ?? [];
    for (const i of imps) {
      const area = (i?.area ?? "").toString().trim();
      if (!area) continue;
      const entry = areaMap.get(area) ?? { count: 0, call_ids: [], suggestions: [], quotes: [] };
      entry.count++;
      if (!entry.call_ids.includes(r.id)) entry.call_ids.push(r.id);
      const sug = (i.suggestion ?? "").toString().trim();
      if (sug) entry.suggestions.push(sug);
      const q = (i.example_quote ?? "").toString().trim();
      if (q) entry.quotes.push({ call_id: r.id, quote: q });
      areaMap.set(area, entry);
    }
  }
  const topImprovementAreas = Array.from(areaMap.entries())
    .map(([area, v]) => ({
      area,
      count: v.count,
      call_ids: v.call_ids,
      // Top 5 sugerencias más comunes (dedup case-insensitive aproximada
      // por primeros 40 chars).
      top_suggestions: dedupTop(v.suggestions, 5),
      // Hasta 5 quotes representativas
      example_quotes: v.quotes.slice(0, 5)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ---- 5. Time series diario ----
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
      unique_contacts: uniqueContacts.size,
      unique_companies: uniqueCompanies.size,
      avg_score:
        analyzed.length > 0
          ? Math.round(
              (analyzed.reduce((s, r) => s + Number(r.sdr_score_overall ?? 0), 0) /
                analyzed.length) *
                10
            ) / 10
          : null,
      pickup_rate_calls: pickupRateCalls,
      pickup_calls_numerator: pickupCalls.length,
      pickup_calls_denominator: pickupDenominator,
      pickup_rate_contacts: pickupRateContacts,
      pickup_contacts_numerator: contactsWithPickup.size,
      pickup_contacts_denominator: contactsWorked.size
    },
    sub_scores: subScores,
    response_distribution: responseDistribution,
    sdr_ranking: sdrRanking,
    top_improvement_areas: topImprovementAreas,
    activity
  });
}

function dedupTop(items: string[], n: number): Array<{ text: string; count: number }> {
  const map = new Map<string, { text: string; count: number }>();
  for (const it of items) {
    const key = it.toLowerCase().slice(0, 40);
    const entry = map.get(key) ?? { text: it, count: 0 };
    entry.count++;
    map.set(key, entry);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
