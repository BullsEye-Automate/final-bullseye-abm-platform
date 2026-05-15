import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { researchOneCompany, type CompanyHints } from "@/lib/companyResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/companies/research-one
// Body: { name, linkedin_url?, website?, city?, country? }
//
// Investiga UNA empresa puntual (la que el usuario buscó por nombre),
// la inserta como pending y devuelve la tarjeta. Siempre devuelve algo
// salvo que la empresa no exista en la web.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<CompanyHints>;
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Falta el nombre de la empresa" }, { status: 400 });
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

  // Dedup: si ya existe una empresa con ese nombre, no la duplicamos.
  const { data: existing } = await db
    .from("companies")
    .select("id, company_name, status")
    .ilike("company_name", name)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      already_exists: true,
      company: existing,
      message: `"${name}" ya está en la base (estado: ${existing.status}).`
    });
  }

  let result;
  try {
    result = await researchOneCompany(
      {
        name,
        linkedin_url: body.linkedin_url ?? null,
        website: body.website ?? null,
        city: body.city ?? null,
        country: body.country ?? null
      },
      icp as IcpConfig
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Research failed";
    const overloaded = /overloaded/i.test(raw) || /\b529\b/.test(raw);
    return NextResponse.json(
      {
        error: overloaded
          ? "Anthropic API saturada (529). Reintentá en 30-60 segundos."
          : raw
      },
      { status: overloaded ? 503 : 500 }
    );
  }

  if (result.not_found || !result.company) {
    return NextResponse.json({
      not_found: true,
      message: `No se encontró información pública de "${name}". Prueba con el nombre completo o agrega el LinkedIn URL.`,
      diagnostics: result.diagnostics
    });
  }

  const c = result.company;
  const { data: inserted, error: insertErr } = await db
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
    .select("id, company_name, status, fit_score, company_type")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    inserted: inserted ?? null,
    off_target: result.off_target,
    diagnostics: result.diagnostics
  });
}
