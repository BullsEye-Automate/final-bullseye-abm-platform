import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToHubSpot, type HubSpotCompanyInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hubspot/push-company/[id]
// Sincroniza una empresa de Supabase con HubSpot.

const COMPANY_FIELDS =
  "id, company_name, company_website, company_linkedin_url, company_city, company_country, " +
  "company_size, company_type, tool_primary, tool_secondary, fit_signals, fit_score, " +
  "approved_at, clay_pushed_at, hubspot_company_id";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: companyRaw, error: fetchErr } = await db
    .from("companies")
    .select(COMPANY_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!companyRaw) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  const result = await pushCompanyToHubSpot(db, companyRaw as unknown as HubSpotCompanyInput);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    companyId: id,
    hubspot_id: result.hubspot_id,
    created: result.created,
  });
}
