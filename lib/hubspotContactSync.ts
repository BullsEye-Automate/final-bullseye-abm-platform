// Sincroniza un contacto (y su empresa) a HubSpot. Empuja la empresa
// primero para tener su id y poder asociar el contacto. Idempotente:
// pushContactToHubSpot busca por wecad_contact_id / email antes de crear.
//
// Se usa desde el webhook /api/clay/scored-contacts (cuando Clay marca
// fit_action='enrich', el contacto entra a la campaña de Lemlist) y desde
// el endpoint de backfill /api/hubspot/sync-campaign-contacts.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushCompanyToHubSpot,
  pushContactToHubSpot,
  type HubSpotCompanyInput,
  type HubSpotContactInput,
  type HubSpotPushResult
} from "./hubspotPush";

const CONTACT_FIELDS =
  "id, company_id, first_name, last_name, job_title, email, phone, linkedin_url, " +
  "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, " +
  "human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
  "phone_enrichment_status, phone_source, hubspot_contact_id";

const COMPANY_FIELDS =
  "id, company_name, company_website, company_linkedin_url, company_city, company_country, " +
  "company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, " +
  "approved_at, clay_pushed_at, hubspot_company_id";

export async function syncContactToHubSpot(
  db: SupabaseClient,
  contactId: string
): Promise<HubSpotPushResult | { ok: false; error: string }> {
  const { data: contactRaw, error } = await db
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("id", contactId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!contactRaw) return { ok: false, error: "Contact not found" };
  const contact = contactRaw as unknown as HubSpotContactInput;

  let hubspotCompanyId: string | null = null;
  let companySnapshot: {
    company_type: string | null;
    cad_software: string | null;
    scanner_technology: string | null;
  } | null = null;

  if (contact.company_id) {
    const { data: companyRaw } = await db
      .from("companies")
      .select(COMPANY_FIELDS)
      .eq("id", contact.company_id)
      .maybeSingle();
    const company = companyRaw as unknown as HubSpotCompanyInput | null;
    if (company) {
      const cRes = await pushCompanyToHubSpot(db, company);
      if (cRes.ok) hubspotCompanyId = cRes.hubspot_id;
      companySnapshot = {
        company_type: company.company_type,
        cad_software: company.cad_software,
        scanner_technology: company.scanner_technology
      };
    }
  }

  return pushContactToHubSpot(db, contact, hubspotCompanyId, companySnapshot);
}
