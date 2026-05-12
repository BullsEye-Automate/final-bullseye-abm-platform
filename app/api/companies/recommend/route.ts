import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { discoverCompanies } from "@/lib/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  region?: string;
  size_min?: number;
  size_max?: number | null;
  limit?: number;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const region = body.region ?? "US";
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 15);

  const db = supabaseAdmin();

  const { data: icp, error: icpErr } = await db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (icpErr) return NextResponse.json({ error: icpErr.message }, { status: 500 });
  if (!icp) return NextResponse.json({ error: "No active ICP configured" }, { status: 400 });

  // Tamaño objetivo: tiene que matchear una size_rule aprobada del ICP. Si no
  // viene en el body, usamos la primera regla approve (sweet spot por defecto).
  const approveRules = (icp.size_rules ?? []).filter(
    (r: { decision: string }) => r.decision === "approve"
  ) as { min: number; max: number | null; note?: string | null }[];
  if (approveRules.length === 0) {
    return NextResponse.json(
      { error: "El ICP activo no tiene size_rules con decision=approve" },
      { status: 400 }
    );
  }
  const requestedMin = body.size_min;
  const requestedMax = body.size_max === undefined ? null : body.size_max;
  const matchedRule =
    typeof requestedMin === "number"
      ? approveRules.find((r) => r.min === requestedMin && (r.max ?? null) === requestedMax)
      : null;
  const sizeRule = matchedRule ?? approveRules[0];

  const { data: existing, error: exErr } = await db
    .from("companies")
    .select("company_name")
    .limit(1000);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const exclude = (existing ?? []).map((r) => r.company_name);

  let discovered;
  try {
    discovered = await discoverCompanies({
      icp: icp as IcpConfig,
      region,
      size_min: sizeRule.min,
      size_max: sizeRule.max ?? null,
      size_note: sizeRule.note ?? null,
      limit,
      exclude
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Discovery failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (discovered.length === 0) {
    return NextResponse.json({ inserted: [], skipped: 0 });
  }

  const rows = discovered.map((c) => ({
    company_name: c.company_name,
    company_website: c.company_website,
    company_linkedin_url: c.company_linkedin_url,
    company_city: c.company_city,
    company_country: c.company_country,
    company_size: c.company_size,
    company_type: c.company_type,
    cad_software: c.cad_software,
    scanner_technology: c.scanner_technology,
    fit_signals: c.fit_signals,
    fit_score: c.fit_score,
    research_summary: c.research_summary,
    research_sources: c.research_sources,
    competitor_match: c.competitor_match,
    status: "pending" as const,
    icp_version: icp.version
  }));

  const existingLower = new Set(exclude.map((n) => n.toLowerCase()));
  const seenLower = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    const k = r.company_name.toLowerCase();
    if (existingLower.has(k) || seenLower.has(k)) return false;
    seenLower.add(k);
    return true;
  });

  if (dedupedRows.length === 0) {
    return NextResponse.json({ inserted: [], skipped: rows.length });
  }

  const { data: inserted, error: insertErr } = await db
    .from("companies")
    .insert(dedupedRows)
    .select("id, company_name, status, fit_score");
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    inserted: inserted ?? [],
    skipped: rows.length - (inserted?.length ?? 0)
  });
}
