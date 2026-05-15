// Re-verifica una empresa ya guardada usando el research one-shot honesto
// (mismas reglas estrictas de evidencia que cualquier descubrimiento nuevo).
//
// Disparador: muchas empresas viejas en la base fueron descubiertas con el
// prompt anterior, que rellenaba señales operativas a partir de contexto
// genérico del rubro. Este endpoint vuelve a investigar la empresa
// específicamente y reemplaza fit_signals / cad_software / scanner /
// research_summary / research_sources / fit_score / competitor_match con
// los valores honestos.
//
// Body opcional: { apply?: boolean } — default true (escribe los cambios
// en la DB). Si apply=false, solo devuelve la comparación antes/después
// para que el usuario decida.
//
// Idempotente: re-correr no hace daño, solo reemplaza con la versión
// honesta más reciente.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { researchOneCompany } from "@/lib/companyResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
  const apply = body.apply !== false; // default true

  const db = supabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, research_summary, research_sources, competitor_match, status, icp_version"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const { data: icp, error: icpErr } = await db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (icpErr) return NextResponse.json({ error: icpErr.message }, { status: 500 });
  if (!icp) return NextResponse.json({ error: "No active ICP configured" }, { status: 400 });

  let result;
  try {
    result = await researchOneCompany(
      {
        name: existing.company_name,
        linkedin_url: existing.company_linkedin_url,
        website: existing.company_website,
        city: existing.company_city,
        country: existing.company_country
      },
      icp as IcpConfig
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Research failed";
    const overloaded = /overloaded/i.test(raw) || /\b529\b/.test(raw);
    return NextResponse.json(
      {
        error: overloaded
          ? "Anthropic API saturada (529). Reintenta en 30-60 segundos."
          : raw
      },
      { status: overloaded ? 503 : 500 }
    );
  }

  if (result.not_found || !result.company) {
    return NextResponse.json({
      not_found: true,
      message: `No se encontró información pública nueva sobre "${existing.company_name}". La empresa queda como estaba.`,
      diagnostics: result.diagnostics
    });
  }

  const fresh = result.company;
  const diff = {
    fit_score: { before: existing.fit_score, after: fresh.fit_score },
    fit_signals: { before: existing.fit_signals, after: fresh.fit_signals },
    cad_software: { before: existing.cad_software, after: fresh.cad_software },
    scanner_technology: {
      before: existing.scanner_technology,
      after: fresh.scanner_technology
    },
    competitor_match: { before: existing.competitor_match, after: fresh.competitor_match },
    company_size: { before: existing.company_size, after: fresh.company_size },
    research_summary: { before: existing.research_summary, after: fresh.research_summary },
    research_sources_count: {
      before: (existing.research_sources as unknown[] | null)?.length ?? 0,
      after: fresh.research_sources.length
    },
    evidence_quality: { after: fresh.evidence_quality }
  };

  if (!apply) {
    return NextResponse.json({
      id: existing.id,
      company_name: existing.company_name,
      diff,
      diagnostics: result.diagnostics,
      applied: false
    });
  }

  // Aplicamos. Nunca pisamos el status (approved / pending / rejected) ni
  // los IDs/timestamps de integraciones (Clay, HubSpot, etc.) — eso es
  // estado operativo, no de investigación.
  const { error: updateErr } = await db
    .from("companies")
    .update({
      // Campos de research
      cad_software: fresh.cad_software,
      scanner_technology: fresh.scanner_technology,
      fit_signals: fresh.fit_signals,
      fit_score: fresh.fit_score,
      competitor_match: fresh.competitor_match,
      research_summary: fresh.research_summary,
      research_sources: fresh.research_sources,
      // Campos descriptivos solo si el research aportó datos nuevos
      // (no pisamos valores existentes con null).
      company_size: fresh.company_size ?? existing.company_size,
      company_city: fresh.company_city ?? existing.company_city,
      company_country: fresh.company_country ?? existing.company_country,
      company_website: fresh.company_website ?? existing.company_website,
      company_linkedin_url: fresh.company_linkedin_url ?? existing.company_linkedin_url,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({
    id: existing.id,
    company_name: existing.company_name,
    diff,
    diagnostics: result.diagnostics,
    applied: true,
    evidence_quality: fresh.evidence_quality
  });
}
