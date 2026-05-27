import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToClay } from "@/lib/clayPush";
import { triggerDeepResearchForCompany } from "@/lib/deep-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId: string | null   = body.client_id ?? null;
  const companyIds: string[] | undefined = body.company_ids;

  const db = supabaseAdmin();

  let q = db
    .from("companies")
    .select("id, company_name, company_linkedin_url, company_website, company_size, company_city, company_country, company_type, fit_signals, fit_score, cad_software, scanner_technology, client_id")
    .eq("status", "pending")
    .limit(50);
  if (clientId) q = q.eq("client_id", clientId);
  if (companyIds?.length) q = q.in("id", companyIds);

  const { data: companies, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!companies?.length) return NextResponse.json({ approved: 0, clay_errors: 0 });

  let approved = 0, clayErrors = 0;
  for (const c of companies) {
    const { error: updErr } = await db
      .from("companies")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: "bulk" })
      .eq("id", c.id);
    if (updErr) { clayErrors++; continue; }
    approved++;
    pushCompanyToClay(db, c.id).catch(() => {
      db.from("companies").update({ clay_push_error: "bulk push failed" }).eq("id", c.id);
    });
    triggerDeepResearchForCompany(db, c.id).catch(() => {});
  }

  return NextResponse.json({ approved, clay_errors: clayErrors });
}
