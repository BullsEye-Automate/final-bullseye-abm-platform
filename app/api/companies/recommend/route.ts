import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { discoverCompanies, type DiscoveredCompany } from "@/lib/discovery";
import { researchOneCompany } from "@/lib/companyResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  region?: string;
  size_min?: number;
  size_max?: number | null;
  limit?: number;
  // Cuando true (default), solo entran empresas con cita específica que las
  // nombre. Cuando false, también entran "generic" (citas del rubro sin
  // nombrar a la empresa) — útil cuando el régimen estricto descarta todo.
  require_specific_evidence?: boolean;
  // Cuando true (default), después del discovery broad cada candidato se
  // re-investiga con researchOneCompany (búsqueda dedicada por empresa).
  // El broad es ancho pero superficial; el deep trae cad_software,
  // scanner, fit_signals con citas específicas. Costo: ~$0.04 USD por
  // empresa + ~30s extra para 12 empresas. Cuando false, se inserta con
  // los datos del broad directo (más rápido, más barato, menos calidad).
  deep_reverify?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const region = body.region ?? "US";
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 15);
  const requireSpecific = body.require_specific_evidence !== false;
  const deepReverify = body.deep_reverify !== false;

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

  let discoveredResult;
  let retried = false;
  let evidenceRelaxedAuto = false;
  try {
    discoveredResult = await discoverCompanies({
      icp: icp as IcpConfig,
      region,
      size_min: sizeRule.min,
      size_max: sizeRule.max ?? null,
      size_note: sizeRule.note ?? null,
      limit,
      exclude,
      overshoot: 3,
      verify_linkedin_live: true,
      strict_region: true,
      require_specific_evidence: requireSpecific
    });

    // Si la pasada estricta no dejó nada, reintentamos UNA vez relajando
    // SOLO la región (Claude a veces devuelve company_country=null incluso
    // cuando la empresa está en US). Mantenemos la verificación HTTP de
    // LinkedIn — sin ella entrarían URLs alucinadas y la calidad cae mucho.
    if (discoveredResult.companies.length === 0) {
      retried = true;
      const relaxed = await discoverCompanies({
        icp: icp as IcpConfig,
        region,
        size_min: sizeRule.min,
        size_max: sizeRule.max ?? null,
        size_note: sizeRule.note ?? null,
        limit,
        exclude,
        overshoot: 3,
        verify_linkedin_live: true,
        strict_region: false,
        require_specific_evidence: requireSpecific
      });
      discoveredResult = relaxed;
    }

    // Si la pasada relajada por región tampoco dejó nada y el usuario tenía
    // el régimen estricto activo, hacemos un último intento relajando ADEMÁS
    // el filtro de evidencia. Mejor entregar empresas con evidencia genérica
    // (badge visible en cada card) que devolver 0 al SDR.
    if (discoveredResult.companies.length === 0 && requireSpecific) {
      evidenceRelaxedAuto = true;
      const evidenceRelaxed = await discoverCompanies({
        icp: icp as IcpConfig,
        region,
        size_min: sizeRule.min,
        size_max: sizeRule.max ?? null,
        size_note: sizeRule.note ?? null,
        limit,
        exclude,
        overshoot: 3,
        verify_linkedin_live: true,
        strict_region: false,
        require_specific_evidence: false
      });
      discoveredResult = evidenceRelaxed;
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Discovery failed";
    // Detect Anthropic's transient overload (the SDK already retries 5
    // times with backoff; if we still see this, their API is hammered).
    const overloaded =
      /overloaded/i.test(raw) || /\b529\b/.test(raw) || /rate.?limit/i.test(raw);
    const msg = overloaded
      ? "Anthropic API saturada (529 Overloaded). Reintenta en 30-60 segundos."
      : raw;
    return NextResponse.json({ error: msg }, { status: overloaded ? 503 : 500 });
  }

  const discoveredBroad = discoveredResult.companies;
  const diagnostics: Record<string, unknown> = {
    ...discoveredResult.diagnostics,
    retried,
    evidence_relaxed_auto: evidenceRelaxedAuto,
    deep_reverify: deepReverify
  };

  if (discoveredBroad.length === 0) {
    return NextResponse.json({ inserted: [], skipped: 0, diagnostics });
  }

  // ── Paso 2 opcional: deep re-verify ─────────────────────────────
  // Por cada candidato del broad, una segunda pasada con
  // researchOneCompany (Perplexity dedicado por empresa + Claude). La
  // calidad de los signals / cad_software / scanner sube de manera
  // notoria — el broad es ancho pero superficial. Si el reverify falla
  // o no encuentra nada, se mantiene la versión del broad como fallback.
  let polished: DiscoveredCompany[] = discoveredBroad;
  let reverifyOk = 0;
  let reverifyFail = 0;
  if (deepReverify) {
    polished = [];
    const CHUNK = 3;
    for (let i = 0; i < discoveredBroad.length; i += CHUNK) {
      const chunk = discoveredBroad.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (c) => {
          try {
            const r = await researchOneCompany(
              {
                name: c.company_name,
                linkedin_url: c.company_linkedin_url,
                website: c.company_website,
                city: c.company_city,
                country: c.company_country
              },
              icp as IcpConfig
            );
            if (r.company && !r.not_found) {
              reverifyOk++;
              // El reverify es estrictamente más informado. Mantenemos el
              // evidence_quality del broad (cómputo idéntico) y mergeamos
              // preferiendo el reverify campo a campo cuando trae valor
              // y el broad no, o cuando el reverify es más sustancioso.
              return mergeBroadAndReverify(c, r.company);
            }
            reverifyFail++;
            return c;
          } catch {
            reverifyFail++;
            return c;
          }
        })
      );
      polished.push(...results);
    }
    diagnostics.reverify_ok = reverifyOk;
    diagnostics.reverify_fail = reverifyFail;
  }

  const rows = polished.map((c) => ({
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
    return NextResponse.json({ inserted: [], skipped: rows.length, diagnostics });
  }

  const { data: inserted, error: insertErr } = await db
    .from("companies")
    .insert(dedupedRows)
    .select("id, company_name, status, fit_score");
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    inserted: inserted ?? [],
    skipped: rows.length - (inserted?.length ?? 0),
    diagnostics
  });
}

// Mergea broad + reverify campo a campo, prefiriendo el valor más útil:
// - Para campos null/string: reverify gana si tiene valor y el broad no, o
//   si su string es más sustancioso (más caracteres).
// - Para citas: reverify gana si tiene MÁS.
// - Para fit_score: gana el más permisivo del reverify (que ya aplicó el
//   régimen estricto sobre data más profunda).
function mergeBroadAndReverify(
  broad: DiscoveredCompany,
  reverify: DiscoveredCompany
): DiscoveredCompany {
  const pickStr = (a: string | null, b: string | null) => {
    if (b && (!a || b.length > a.length)) return b;
    return a;
  };
  const pickNum = (a: number | null, b: number | null) => (b != null ? b : a);
  return {
    company_name: broad.company_name,
    company_website: pickStr(broad.company_website, reverify.company_website),
    company_linkedin_url: pickStr(broad.company_linkedin_url, reverify.company_linkedin_url),
    company_city: pickStr(broad.company_city, reverify.company_city),
    company_country: pickStr(broad.company_country, reverify.company_country),
    company_size: pickNum(broad.company_size, reverify.company_size),
    company_type: reverify.company_type !== "other" ? reverify.company_type : broad.company_type,
    cad_software: pickStr(broad.cad_software, reverify.cad_software),
    scanner_technology: pickStr(broad.scanner_technology, reverify.scanner_technology),
    fit_signals:
      reverify.fit_signals && reverify.fit_signals.length > broad.fit_signals.length
        ? reverify.fit_signals
        : broad.fit_signals,
    fit_score: reverify.fit_score,
    competitor_match: pickStr(broad.competitor_match, reverify.competitor_match),
    research_summary:
      reverify.research_summary &&
      reverify.research_summary.length > broad.research_summary.length
        ? reverify.research_summary
        : broad.research_summary,
    research_sources:
      reverify.research_sources.length > broad.research_sources.length
        ? reverify.research_sources
        : broad.research_sources,
    evidence_quality: reverify.evidence_quality
  };
}
