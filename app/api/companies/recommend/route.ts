import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { discoverCompanies } from "@/lib/discovery";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 120;

type Body = {
  region?:       string;
  size?:         "small" | "medium" | "large";
  size_hint?:    string | null;
  limit?:        number;
  client_id?:    string | null;
  industry_id?:  string | null;
};

export async function POST(req: NextRequest) {
  const body     = (await req.json().catch(() => ({}))) as Body;
  const region     = body.region ?? "US";
  const size       = body.size   ?? "small";
  const sizeHint   = body.size_hint !== undefined ? body.size_hint : undefined;
  const limit      = Math.min(Math.max(body.limit ?? 8, 1), 15);
  const clientId   = body.client_id ?? null;
  const industryId = body.industry_id ?? null;

  if (!clientId) {
    return NextResponse.json(
      { error: "Se requiere client_id. Selecciona un cliente en el sidebar." },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Lee el ICP del cliente desde client_ai_context (datos base compartidos)
  const { data: icpCtx, error: icpErr } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (icpErr) return NextResponse.json({ error: icpErr.message }, { status: 500 });

  if (!icpCtx?.content?.trim()) {
    return NextResponse.json(
      {
        error:
          "Este cliente no tiene ICP configurado. Ve a SISTEMA → ICP para configurarlo antes de buscar empresas."
      },
      { status: 400 }
    );
  }

  // Si se pasa industry_id, componer el ICP con las secciones específicas de esa industria
  let icpContent = icpCtx.content;
  if (industryId) {
    const { data: industrySections } = await db
      .from("icp_industry_sections")
      .select("content")
      .eq("industry_id", industryId);

    const industrySectionTexts = (industrySections ?? [])
      .map((s: { content: string }) => s.content)
      .filter(Boolean)
      .join("\n\n");

    // Extraer solo la sección "DATOS DEL CLIENTE" del ICP base compartido
    const clientDataMatch = icpCtx.content.match(
      /-{10,}\nDATOS DEL CLIENTE\n-{10,}\n\n[\s\S]*?(?=\n\n-{10,}|$)/
    );
    const clientDataSection = clientDataMatch ? clientDataMatch[0] : icpCtx.content;

    icpContent = [clientDataSection, industrySectionTexts].filter(Boolean).join("\n\n");
  }

  // Empresas ya existentes + excluidas manualmente, para evitar duplicados y re-sugerir descartadas
  const [{ data: existing, error: exErr }, { data: excluded }] = await Promise.all([
    db.from("companies").select("company_name").eq("client_id", clientId).limit(1000),
    db.from("excluded_companies").select("company_name").eq("client_id", clientId).limit(1000),
  ]);

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const exclude = [
    ...(existing ?? []).map((r: { company_name: string }) => r.company_name),
    ...(excluded ?? []).map((r: { company_name: string }) => r.company_name),
  ];

  let discovered;
  try {
    discovered = await discoverCompanies({
      icpContent,
      region,
      size,
      sizeHint,
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
    company_name:         c.company_name,
    company_website:      c.company_website,
    company_linkedin_url: c.company_linkedin_url,
    company_city:         c.company_city,
    company_country:      c.company_country,
    company_size:         c.company_size,
    company_type:         c.company_type,
    cad_software:         c.cad_software,
    scanner_technology:   c.scanner_technology,
    fit_signals:          c.fit_signals,
    fit_score:            c.fit_score,
    research_summary:     c.research_summary,
    research_sources:     c.research_sources,
    competitor_match:     c.competitor_match,
    status:               "pending" as const,
    icp_version:          null,
    client_id:            clientId
  }));

  const existingLower = new Set(exclude.map((n: string) => n.toLowerCase()));
  const seenLower     = new Set<string>();
  const dedupedRows   = rows.filter((r) => {
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
    skipped:  rows.length - (inserted?.length ?? 0)
  });
}
