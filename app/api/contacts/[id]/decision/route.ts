import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist, type LemlistPushContact, type LemlistPushCompany } from "@/lib/lemlistPush";
import { pushCompanyToHubSpot, pushContactToHubSpot, type HubSpotCompanyInput, type HubSpotContactInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/decision
// Body: { decision: "approved" | "rejected", reason?: string, by?: string }
//
// Si approved: empuja a Lemlist y sincroniza con HubSpot.
// Si rejected: marca como descartado.

const CONTACT_FIELDS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, " +
  "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, " +
  "human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
  "phone_enrichment_status, phone_source, hubspot_contact_id, client_id, status";

const COMPANY_FIELDS =
  "id, company_name, company_website, company_linkedin_url, company_city, company_country, " +
  "company_size, company_type, tool_primary, tool_secondary, fit_signals, fit_score, " +
  "approved_at, clay_pushed_at, hubspot_company_id";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let body: { decision?: string; reason?: string; by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { decision, reason, by } = body;

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: 'decision debe ser "approved" o "rejected"' },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Cargar contacto completo
  const { data: contactRaw, error: fetchErr } = await db
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contactRaw) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Registrar la decisión humana
  const updateData: Record<string, any> = {
    human_decision: decision,
    human_decision_at: new Date().toISOString(),
    human_decision_reason: reason ?? null,
    human_decision_by: by ?? "manual",
  };

  if (decision === "rejected") {
    updateData["status"] = "discarded";
  } else if (decision === "approved") {
    updateData["fit_action"] = "enrich";
  }

  const { error: updateErr } = await db
    .from("contacts")
    .update(updateData)
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Insertar feedback
  await db.from("contact_feedback").insert({
    contact_id: id,
    decision,
    reason: reason ?? null,
    decided_by: by ?? "manual",
    decided_at: new Date().toISOString()
  }).then(() => {}).catch(() => {});

  if (decision === "rejected") {
    return NextResponse.json({ ok: true, decision, contactId: id });
  }

  // Aprobado: cargar empresa y empujar a Lemlist + HubSpot
  let company: LemlistPushCompany = null;
  let companyHubSpotInput: HubSpotCompanyInput | null = null;

  if (contactRaw.company_id) {
    const { data: companyRaw } = await db
      .from("companies")
      .select(COMPANY_FIELDS)
      .eq("id", contactRaw.company_id)
      .maybeSingle();
    if (companyRaw) {
      company = {
        company_name: companyRaw.company_name,
        company_size: companyRaw.company_size,
        company_type: companyRaw.company_type,
        tool_primary: companyRaw.tool_primary,
        tool_secondary: companyRaw.tool_secondary,
        fit_signals: companyRaw.fit_signals
      };
      companyHubSpotInput = companyRaw as unknown as HubSpotCompanyInput;
    }
  }

  const contact: LemlistPushContact = {
    first_name: contactRaw.first_name,
    last_name: contactRaw.last_name,
    job_title: contactRaw.job_title,
    linkedin_headline: contactRaw.linkedin_headline,
    linkedin_url: contactRaw.linkedin_url,
    email: contactRaw.email,
    phone: contactRaw.phone,
    seniority: contactRaw.seniority,
    fit_score: contactRaw.fit_score,
    fit_reason: contactRaw.fit_reason,
    linkedin_icebreaker: contactRaw.linkedin_icebreaker,
    email_subject: contactRaw.email_subject,
    email_body: contactRaw.email_body
  };

  const lemlistResult = await pushApprovedToLemlist(db, id, contact, company, { clientId: contactRaw.client_id });

  // Sincronizar a HubSpot
  let hubspotResult: { ok: boolean; hubspot_id?: string; error?: string } = { ok: false, error: "Company not loaded" };
  let hubspotCompanyId: string | null = null;

  if (companyHubSpotInput) {
    const cRes = await pushCompanyToHubSpot(db, companyHubSpotInput);
    if (cRes.ok) hubspotCompanyId = cRes.hubspot_id;
  }

  const hsRes = await pushContactToHubSpot(
    db,
    contactRaw as unknown as HubSpotContactInput,
    hubspotCompanyId,
    company ? { company_type: company.company_type, tool_primary: company.tool_primary, tool_secondary: company.tool_secondary } : null
  );
  hubspotResult = hsRes;

  return NextResponse.json({
    ok: true,
    decision,
    contactId: id,
    lemlist: lemlistResult.ok
      ? { ok: true, lead_id: lemlistResult.lead_id, messages_generated: lemlistResult.messages_generated }
      : { ok: false, error: lemlistResult.error },
    hubspot: hubspotResult.ok
      ? { ok: true, hubspot_id: (hubspotResult as any).hubspot_id }
      : { ok: false, error: hubspotResult.error },
  });
}
