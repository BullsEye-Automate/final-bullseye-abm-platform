import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { discoverCompanies } from "@/lib/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  region?:    string;
  size?:      "small" | "medium" | "large";
  limit?:     number;
  client_id?: string | null;
};

export async function POST(req: NextRequest) {
  const body     = (await req.json().catch(() => ({}))) as Body;
  const region   = body.region   ?? "US";
  const size     = body.size     ?? "small";
  const limit    = Math.min(Math.max(body.limit ?? 8, 1), 15);
  const clientId = body.client_id ?? null;

  const db = supabaseAdmin();

  // Busca el ICP activo del cliente (o global si no hay client_id)
  let icpQ = db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1);
  if (clientId) icpQ = icpQ.eq("client_id", clientId);

  const { data: icp, error: icpErr } = await icpQ.maybeSingle();
  if (icpErr) return NextResponse.json({ error: icpErr.message }, { status: 500 });
  if (!icp)   return NextResponse.json({ error: "No hay ICP activo configurado para este cliente" }, { status: 400 });

  // Empresas ya existentes del cliente para excluir duplicados
  let exQ = db.from("companies").select("company_name").limit(1000);
  if (clientId) exQ = exQ.eq("client_id", clientId);
  const { data: existing, error: exErr } = await exQ;
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const exclude = (existing ?? []).map((r) => r.company_name);

  let discovered;
  try {
    discovered = await discoverCompanies({ icp: icp as IcpConfig, region, size, limit, exclude });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Discovery failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (discovered.length === 0) {
    return NextResponse.json({ inserted: [], skipped: 0 });
  }

  const rows = discovered.map((c) => ({
    company_name:        c.company_name,
    company_website:     c.company_website,
    company_linkedin_url: c.company_linkedin_url,
    company_city:        c.company_city,
    company_country:     c.company_country,
    company_size:        c.company_size,
    company_type:        c.company_type,
    cad_software:        c.cad_software,
    scanner_technology:  c.scanner_technology,
    fit_signals:         c.fit_signals,
    fit_score:           c.fit_score,
    research_summary:    c.research_summary,
    research_sources:    c.research_sources,
    competitor_match:    c.competitor_match,
    status:              "pending" as const,
    icp_version:         icp.version,
    client_id:           clientId
  }));

  const existingLower = new Set(exclude.map((n) => n.toLowerCase()));
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
