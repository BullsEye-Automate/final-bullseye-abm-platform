import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { researchOneCompany, type CompanyHints } from "@/lib/companyResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/companies/import
// Body: { companies: [{ name, linkedin_url?, website?, city?, country? }] }
//
// Importa una lista de empresas objetivo (parseada de un CSV en el cliente).
// Para cada una corre researchOneCompany para levantar la info que falte,
// y las inserta como pending. Procesa en chunks paralelos para no saturar
// Perplexity/Anthropic ni el timeout de Vercel.
const CHUNK_SIZE = 3;
const MAX_ROWS = 40;

type ImportResult = {
  ok: boolean;
  received: number;
  researched: number;
  inserted: number;
  skipped_duplicates: number;
  not_found: number;
  off_target: number;
  failed: number;
  rows: Array<{
    name: string;
    status: "inserted" | "duplicate" | "not_found" | "failed";
    company_id?: string;
    fit_score?: string;
    company_type?: string;
    off_target?: boolean;
    error?: string;
  }>;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    companies?: Array<Partial<CompanyHints>>;
  };
  const raw = Array.isArray(body.companies) ? body.companies : [];
  const hints: CompanyHints[] = raw
    .map((r) => ({
      name: (r.name ?? "").trim(),
      linkedin_url: r.linkedin_url?.trim() || null,
      website: r.website?.trim() || null,
      city: r.city?.trim() || null,
      country: r.country?.trim() || null
    }))
    .filter((h) => h.name.length > 0)
    .slice(0, MAX_ROWS);

  if (hints.length === 0) {
    return NextResponse.json(
      { error: "El CSV no tiene filas válidas. Necesita al menos la columna company_name." },
      { status: 400 }
    );
  }

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

  // Set de nombres ya existentes para dedup.
  const { data: existing } = await db.from("companies").select("company_name").limit(2000);
  const existingLower = new Set(
    (existing ?? []).map((r) => (r.company_name ?? "").toLowerCase().trim())
  );

  const result: ImportResult = {
    ok: true,
    received: hints.length,
    researched: 0,
    inserted: 0,
    skipped_duplicates: 0,
    not_found: 0,
    off_target: 0,
    failed: 0,
    rows: []
  };

  // Dedup dentro del propio CSV también.
  const seenInBatch = new Set<string>();

  async function processOne(h: CompanyHints): Promise<void> {
    const key = h.name.toLowerCase().trim();
    if (existingLower.has(key) || seenInBatch.has(key)) {
      result.skipped_duplicates++;
      result.rows.push({ name: h.name, status: "duplicate" });
      return;
    }
    seenInBatch.add(key);

    try {
      const research = await researchOneCompany(h, icp as IcpConfig);
      result.researched++;
      if (research.not_found || !research.company) {
        result.not_found++;
        result.rows.push({ name: h.name, status: "not_found" });
        return;
      }
      const c = research.company;
      const { data: inserted, error: insErr } = await db
        .from("companies")
        .insert({
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
          icp_version: (icp as IcpConfig).version
        })
        .select("id")
        .single();
      if (insErr) {
        result.failed++;
        result.rows.push({ name: h.name, status: "failed", error: insErr.message });
        return;
      }
      result.inserted++;
      if (research.off_target) result.off_target++;
      result.rows.push({
        name: h.name,
        status: "inserted",
        company_id: (inserted as { id: string }).id,
        fit_score: c.fit_score,
        company_type: c.company_type,
        off_target: research.off_target
      });
    } catch (err) {
      result.failed++;
      result.rows.push({
        name: h.name,
        status: "failed",
        error: err instanceof Error ? err.message : "Research failed"
      });
    }
  }

  for (let i = 0; i < hints.length; i += CHUNK_SIZE) {
    const chunk = hints.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(processOne));
  }

  return NextResponse.json(result);
}
