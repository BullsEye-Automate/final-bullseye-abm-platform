// Bulk re-verify de empresas: itera empresas (default: aprobadas con
// evidence_quality != "specific") y corre researchOneCompany honesto sobre
// cada una. Reemplaza fit_signals / cad_software / scanner / fit_score /
// research_summary / research_sources con la versión honesta.
//
// Disparador: PR #115 introdujo el régimen estricto. Las empresas viejas
// (descubiertas con el prompt loose) tienen señales operativas inventadas
// y hay que limpiarlas en bloque antes de retomar las campañas.
//
// Procesamiento: en paralelo en chunks de 3, con cap de 10 empresas por
// request para no exceder el maxDuration de Vercel. Si quedan más, el
// usuario re-corre el endpoint y procesa el siguiente batch.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { researchOneCompany } from "@/lib/companyResearch";
import { evidenceQuality } from "@/lib/companyEvidence";
import type { PerplexityCitation } from "@/lib/perplexity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_LIMIT = 10;
const CONCURRENCY = 3;

type Body = {
  status?: "approved" | "pending" | "rejected" | "all";
  only_non_specific?: boolean; // default true — solo evidence_quality != "specific"
  batch_limit?: number; // override del cap
};

type CompanyRow = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  fit_score: string | null;
  competitor_match: string | null;
  research_summary: string | null;
  research_sources: PerplexityCitation[] | null;
  updated_at: string | null;
};

type PerCompanyResult = {
  id: string;
  company_name: string;
  status: "updated" | "unchanged" | "not_found" | "error";
  before_evidence_quality?: "specific" | "generic" | "none";
  after_evidence_quality?: "specific" | "generic" | "none";
  fit_score_before?: string | null;
  fit_score_after?: string | null;
  fit_signals_changed?: boolean;
  error?: string;
};

async function processOne(
  company: CompanyRow,
  icp: IcpConfig,
  db: ReturnType<typeof supabaseAdmin>
): Promise<PerCompanyResult> {
  const beforeQuality = evidenceQuality(
    company.company_name,
    (company.research_sources ?? []) as PerplexityCitation[]
  );
  try {
    const result = await researchOneCompany(
      {
        name: company.company_name,
        linkedin_url: company.company_linkedin_url,
        website: company.company_website,
        city: company.company_city,
        country: company.company_country
      },
      icp
    );

    if (result.not_found || !result.company) {
      return {
        id: company.id,
        company_name: company.company_name,
        status: "not_found",
        before_evidence_quality: beforeQuality
      };
    }
    const fresh = result.company;
    const fitSignalsChanged = (company.fit_signals ?? "") !== fresh.fit_signals;

    await db
      .from("companies")
      .update({
        cad_software: fresh.cad_software,
        scanner_technology: fresh.scanner_technology,
        fit_signals: fresh.fit_signals,
        fit_score: fresh.fit_score,
        competitor_match: fresh.competitor_match,
        research_summary: fresh.research_summary,
        research_sources: fresh.research_sources,
        company_size: fresh.company_size ?? company.company_size,
        company_city: fresh.company_city ?? company.company_city,
        company_country: fresh.company_country ?? company.company_country,
        company_website: fresh.company_website ?? company.company_website,
        company_linkedin_url: fresh.company_linkedin_url ?? company.company_linkedin_url,
        updated_at: new Date().toISOString()
      })
      .eq("id", company.id);

    return {
      id: company.id,
      company_name: company.company_name,
      status: "updated",
      before_evidence_quality: beforeQuality,
      after_evidence_quality: fresh.evidence_quality,
      fit_score_before: company.fit_score,
      fit_score_after: fresh.fit_score,
      fit_signals_changed: fitSignalsChanged
    };
  } catch (err) {
    return {
      id: company.id,
      company_name: company.company_name,
      status: "error",
      before_evidence_quality: beforeQuality,
      error: err instanceof Error ? err.message : "unknown error"
    };
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const statusFilter = body.status ?? "approved";
  const onlyNonSpecific = body.only_non_specific !== false;
  const limit = Math.min(Math.max(1, body.batch_limit ?? BATCH_LIMIT), 25);

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

  // Traemos un batch un poco más grande que limit (5x) para filtrar las
  // que ya tienen evidence_quality=specific sin gastar Perplexity en ellas.
  // Tipado como `any` para evitar "Type instantiation is excessively deep"
  // en la cadena de filtros condicional de Supabase.
  let query: any = db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, cad_software, scanner_technology, fit_signals, fit_score, competitor_match, research_summary, research_sources, updated_at"
    )
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(limit * 5);
  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const all = (rows ?? []) as CompanyRow[];
  const filtered = onlyNonSpecific
    ? all.filter(
        (r) =>
          evidenceQuality(r.company_name, (r.research_sources ?? []) as PerplexityCitation[]) !==
          "specific"
      )
    : all;
  const batch = filtered.slice(0, limit);

  // Procesamos en paralelo con concurrencia limitada (chunks de N).
  const results: PerCompanyResult[] = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((c) => processOne(c, icp as IcpConfig, db))
    );
    results.push(...chunkResults);
  }

  // Cuántas quedan después de este batch (estimación).
  const remaining = Math.max(0, filtered.length - batch.length);

  const summary = {
    processed: results.length,
    updated: results.filter((r) => r.status === "updated").length,
    not_found: results.filter((r) => r.status === "not_found").length,
    errors: results.filter((r) => r.status === "error").length,
    quality_improved: results.filter(
      (r) =>
        r.before_evidence_quality !== "specific" && r.after_evidence_quality === "specific"
    ).length,
    quality_still_generic: results.filter(
      (r) =>
        r.before_evidence_quality !== "specific" && r.after_evidence_quality !== "specific"
    ).length,
    fit_score_downgraded: results.filter(
      (r) => r.fit_score_before === "high" && r.fit_score_after !== "high"
    ).length,
    remaining_in_queue: remaining
  };

  return NextResponse.json({ summary, results });
}
