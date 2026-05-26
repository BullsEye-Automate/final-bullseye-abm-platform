import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist, type LemlistPushContact, type LemlistPushCompany } from "@/lib/lemlistPush";
import { pushCompanyToHubSpot, pushContactToHubSpot, type HubSpotCompanyInput, type HubSpotContactInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/push-to-lemlist
// Empuja manualmente un contacto aprobado a Lemlist y sincroniza con HubSpot.
// Regenera mensajes siempre (force_regenerate=true).

const CONTACT_FIELDS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, " +
  "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, " +
  "human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
  "phone_enrichment_status, phone_source, hubspot_contact_id, client_id";

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

  // Cargar contacto completo
  const { data: contactRaw, error: fetchErr } = await db
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contactRaw) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Verificar requisitos mínimos
  if (!contactRaw.email && !contactRaw.linkedin_url) {
    return NextResponse.json({ error: "El contacto no tiene email ni LinkedIn URL" }, { status: 400 });
  }

  // Cargar empresa
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

  const result = await pushApprovedToLemlist(db, id, contact, company, {
    force_regenerate: true,
    clientId: contactRaw.client_id
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Sincronizar a HubSpot
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

  return NextResponse.json({
    ok: true,
    contactId: id,
    lead_id: result.lead_id,
    messages_generated: result.messages_generated,
    hubspot: hsRes.ok ? { ok: true, hubspot_id: (hsRes as any).hubspot_id } : { ok: false, error: hsRes.error }
  });
}
