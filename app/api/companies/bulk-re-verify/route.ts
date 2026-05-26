import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { discoverCompanies } from "@/lib/discovery";
import { evidenceQuality } from "@/lib/companyEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body        = await req.json().catch(() => ({}));
  const clientId: string | null   = body.client_id ?? null;
  const batchLimit  = Math.min(body.batch_limit ?? 10, 25);
  const companyIds: string[] | undefined = body.company_ids;

  const db = supabaseAdmin();
  let q = db.from("companies").select("*").limit(batchLimit);
  if (clientId) q = q.eq("client_id", clientId);
  if (companyIds?.length) q = q.in("id", companyIds);

  const { data: companies, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type ResultItem = {
    id: string; company_name: string;
    status: "updated" | "unchanged" | "not_found" | "error";
    before_evidence_quality?: string; after_evidence_quality?: string;
    error?: string;
  };
  const results: ResultItem[] = [];
  let updated = 0, notFound = 0, errors = 0, qualityImproved = 0;

  for (let i = 0; i < (companies ?? []).length; i += 3) {
    const chunk = (companies ?? []).slice(i, i + 3);
    await Promise.all(chunk.map(async c => {
      try {
        const beforeEq = evidenceQuality(c.company_name, c.research_sources ?? []);
        const fresh = await discoverCompanies({
          icpContent: icpCtx?.content ?? "",
          region:     c.company_country ?? "LATAM",
          limit:      1, sizeHint: null, exclude: []
        }).catch(() => []);

        if (!fresh.length) {
          notFound++;
          results.push({ id: c.id, company_name: c.company_name, status: "not_found" });
          return;
        }

        const f = fresh[0];
        const afterEq = evidenceQuality(f.company_name, f.research_sources ?? []);
        const upd: Record<string, unknown> = {};
        for (const field of ["fit_signals","fit_score","research_summary","research_sources","cad_software","scanner_technology"] as const) {
          if ((f as Record<string, unknown>)[field] != null) upd[field] = (f as Record<string, unknown>)[field];
        }
        if (Object.keys(upd).length > 0) {
          await db.from("companies").update(upd).eq("id", c.id);
          updated++;
          if (beforeEq !== "specific" && afterEq === "specific") qualityImproved++;
        }
        results.push({ id: c.id, company_name: c.company_name, status: Object.keys(upd).length > 0 ? "updated" : "unchanged", before_evidence_quality: beforeEq, after_evidence_quality: afterEq });
      } catch (e) {
        errors++;
        results.push({ id: c.id, company_name: c.company_name, status: "error", error: String(e) });
      }
    }));
  }

  return NextResponse.json({
    summary: { processed: (companies ?? []).length, updated, not_found: notFound, errors, quality_improved: qualityImproved },
    results
  });
}
