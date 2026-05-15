import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { evidenceQuality } from "@/lib/companyEvidence";
import type { PerplexityCitation } from "@/lib/perplexity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, research_summary, research_sources, competitor_match, status, reject_reason, approved_by, approved_at, icp_version, clay_pushed_at, clay_push_error, clay_no_contacts_at, hubspot_company_id, hubspot_synced_at, hubspot_sync_error, created_at, updated_at"
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Calidad de evidencia se computa on-the-fly desde research_sources guardadas.
  // Una empresa con `generic` o `none` probablemente fue descubierta con el
  // prompt viejo (pre fix 2026-05-15d) y tiene datos operativos sospechosos.
  // La UI surfacea esto como badge para que el usuario priorice re-verificarla.
  const companies = (data ?? []).map((c: any) => ({
    ...c,
    evidence_quality: evidenceQuality(
      c.company_name,
      (c.research_sources ?? []) as PerplexityCitation[]
    )
  }));

  const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "approved"),
    db.from("companies").select("id", { count: "exact", head: true }).eq("status", "rejected")
  ]);

  return NextResponse.json(
    {
      companies,
      counts: {
        pending: pendingRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
