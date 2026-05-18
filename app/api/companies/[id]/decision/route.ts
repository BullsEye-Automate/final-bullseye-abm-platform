import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToHubSpot, type HubSpotCompanyInput } from "@/lib/hubspotPush";
import { pushCompanyToClay } from "@/lib/clayPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  decision: "approved" | "rejected";
  reason?: string;
  reviewer?: string;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as Body;
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }
  if (body.decision === "rejected" && !body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required when rejecting" }, { status: 400 });
  }

  const reviewer = body.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const db = supabaseAdmin();

  const { data: company, error: fetchErr } = await db
    .from("companies")
    .select(
      "id, company_name, status, reject_reason, approved_by, approved_at, fit_score, fit_signals, icp_version"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const update =
    body.decision === "approved"
      ? {
          status: "approved" as const,
          approved_by: reviewer,
          approved_at: new Date().toISOString(),
          reject_reason: null
        }
      : {
          status: "rejected" as const,
          reject_reason: body.reason!,
          approved_by: null,
          approved_at: null
        };

  const { data: updated, error: updateErr } = await db
    .from("companies")
    .update(update)
    .eq("id", params.id)
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, research_summary, status, reject_reason, approved_by, approved_at, icp_version, clay_pushed_at, clay_push_error, hubspot_company_id, hubspot_synced_at, hubspot_sync_error"
    )
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { error: fbErr } = await db.from("company_feedback").insert({
    company_id: params.id,
    reviewer,
    decision: body.decision,
    reason: body.reason ?? null,
    ai_fit_score: company.fit_score,
    ai_fit_signals: company.fit_signals,
    icp_version: company.icp_version
  });
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  // Si fue aprobación, push a HubSpot. Lo hacemos en background-ish (await
  // pero no bloqueamos en caso de error — la decisión ya está persistida
  // y el usuario puede reintentar desde la UI).
  let hubspot_push:
    | { ok: true; hubspot_id: string; created: boolean }
    | { ok: false; error: string; status?: number; debug?: unknown }
    | null = null;
  // Auto-push a Clay al aprobar: el SDR ya decidió que la empresa entra
  // al funnel, no tiene sentido un segundo clic manual ("Prospectar en
  // Clay"). Best-effort: si Clay falla, queda con clay_push_error y la
  // UI muestra el botón retry.
  let clay_push:
    | { ok: true; company_id: string }
    | { ok: false; error: string; status?: number; skipped?: string }
    | null = null;
  if (body.decision === "approved") {
    const [hsRes, clayRes] = await Promise.all([
      pushCompanyToHubSpot(db, updated as HubSpotCompanyInput),
      pushCompanyToClay(db, params.id)
    ]);
    hubspot_push = hsRes;
    clay_push = clayRes.ok
      ? { ok: true, company_id: params.id }
      : { ok: false, error: clayRes.error, status: clayRes.status, skipped: clayRes.skipped };
  }

  // Re-fetch para devolver el estado actualizado de HubSpot a la UI.
  const { data: refetched } = await db
    .from("companies")
    .select(
      "id, company_name, status, reject_reason, approved_by, approved_at, fit_score, fit_signals, icp_version, hubspot_company_id, hubspot_synced_at, hubspot_sync_error"
    )
    .eq("id", params.id)
    .single();

  return NextResponse.json({ company: refetched ?? updated, hubspot_push, clay_push });
}
