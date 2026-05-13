import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToHubSpot, type HubSpotCompanyInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reintenta o ejecuta manualmente el push de una empresa a HubSpot.
// Idempotente.

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: company, error: cErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const result = await pushCompanyToHubSpot(db, company as HubSpotCompanyInput);

  const { data: refetched } = await db
    .from("companies")
    .select("id, hubspot_company_id, hubspot_synced_at, hubspot_sync_error")
    .eq("id", params.id)
    .single();

  return NextResponse.json({ company: refetched, hubspot_push: result });
}
