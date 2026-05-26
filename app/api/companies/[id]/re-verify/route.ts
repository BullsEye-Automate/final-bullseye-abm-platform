import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { discoverCompanies } from "@/lib/discovery";
import { evidenceQuality } from "@/lib/companyEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("companies")
    .select("*")
    .eq("id", params.id)
    .single();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const companies = await discoverCompanies({
    icpContent:  icpCtx?.content ?? "",
    region:      existing.company_country ?? "LATAM",
    limit:       1,
    sizeHint:    null,
    exclude:     []
  }).catch(() => []);

  if (!companies.length) {
    return NextResponse.json({
      not_found: true,
      message:   "No se pudo re-investigar la empresa. Intentá más tarde.",
      evidence_quality: "none",
      changed_fields:   []
    });
  }

  const fresh = companies[0];
  const beforeEq = evidenceQuality(existing.company_name, existing.research_sources ?? []);
  const afterEq  = evidenceQuality(fresh.company_name,    fresh.research_sources    ?? []);

  const fieldsToCheck = [
    "fit_signals", "fit_score", "research_summary",
    "research_sources", "cad_software", "scanner_technology", "company_size"
  ] as const;
  const update: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const f of fieldsToCheck) {
    const freshVal = (fresh as Record<string, unknown>)[f];
    if (freshVal != null && JSON.stringify(freshVal) !== JSON.stringify(existing[f])) {
      update[f] = freshVal;
      changedFields.push(f);
    }
  }

  if (Object.keys(update).length > 0) {
    await db.from("companies").update(update).eq("id", params.id);
  }

  return NextResponse.json({
    company:                { ...existing, ...update },
    evidence_quality:       afterEq,
    changed_fields:         changedFields,
    before_evidence_quality: beforeEq,
    after_evidence_quality:  afterEq
  });
}
