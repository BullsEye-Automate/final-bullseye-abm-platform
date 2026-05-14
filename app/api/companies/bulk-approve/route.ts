import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToHubSpot, type HubSpotCompanyInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Aprueba en masa todas las empresas pendientes. Mismo efecto que aprobar
// una por una desde la UI: status=approved, registro en company_feedback,
// y push a HubSpot (best-effort — un fallo de HubSpot no aborta el lote;
// la empresa queda aprobada y se puede re-sincronizar desde la card).
type Body = { reviewer?: string };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const reviewer = body?.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const db = supabaseAdmin();

  const { data: pending, error: selErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id, icp_version"
    )
    .eq("status", "pending");
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!pending || pending.length === 0) {
    return NextResponse.json({ approved: 0, total: 0, hubspot_errors: 0 });
  }

  const ids = pending.map((c) => c.id);
  const approvedAt = new Date().toISOString();

  const { error: updErr } = await db
    .from("companies")
    .update({
      status: "approved",
      approved_by: reviewer,
      approved_at: approvedAt,
      reject_reason: null
    })
    .in("id", ids);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { error: fbErr } = await db.from("company_feedback").insert(
    pending.map((c) => ({
      company_id: c.id,
      reviewer,
      decision: "approved",
      reason: null,
      ai_fit_score: c.fit_score,
      ai_fit_signals: c.fit_signals,
      icp_version: c.icp_version
    }))
  );
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  // Push a HubSpot en serie para no pegar rate limits. Best-effort: el
  // error queda persistido en hubspot_sync_error por pushCompanyToHubSpot.
  let hubspot_errors = 0;
  for (const c of pending) {
    const r = await pushCompanyToHubSpot(db, {
      ...c,
      approved_at: approvedAt
    } as HubSpotCompanyInput);
    if (r && r.ok === false) hubspot_errors++;
  }

  return NextResponse.json({
    approved: pending.length,
    total: pending.length,
    hubspot_errors
  });
}
