// Lógica para sincronizar empresas y contactos de Supabase con HubSpot.
// Usa prefijo bullseye_ en todas las propiedades custom.

import { supabaseAdmin } from "@/lib/supabase";
import {
  createHubspotCompany,
  updateHubspotCompany,
  searchHubspotCompanyByDomain,
  createHubspotContact,
  updateHubspotContact,
  searchHubspotContactByEmail,
  associateContactToCompany,
} from "@/lib/hubspot";
import { APP_PREFIX } from "@/lib/hubspotProperties";

// ── Push de empresa ───────────────────────────────────────────────────────────

export type CompanyPushResult =
  | { ok: true; hubspotCompanyId: string; created: boolean }
  | { ok: false; error: string };

export async function pushCompanyToHubspot(
  companyId: string
): Promise<CompanyPushResult> {
  const db = supabaseAdmin();

  const { data: company, error: companyErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, " +
        "company_city, company_country, company_size, company_type, " +
        "tool_primary, tool_secondary, fit_score, status, " +
        "research_summary, hubspot_company_id"
    )
    .eq("id", companyId)
    .maybeSingle();

  if (companyErr || !company) {
    return {
      ok: false,
      error: companyErr?.message ?? "Empresa no encontrada",
    };
  }

  // Construir propiedades HubSpot
  const props: Record<string, string> = {};

  if (company.company_name) props["name"] = company.company_name;
  if (company.company_website) {
    // Extraer dominio limpio
    const domain = company.company_website
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    props["domain"] = domain;
    props["website"] = company.company_website;
  }
  if (company.company_city) props["city"] = company.company_city;
  if (company.company_country) props["country"] = company.company_country;
  if (company.company_size) props["numberofemployees"] = String(company.company_size);

  // Propiedades custom bullseye_
  props[`${APP_PREFIX}_company_id`] = companyId;
  if (company.fit_score) props[`${APP_PREFIX}_fit_score`] = company.fit_score;
  if (company.status) props[`${APP_PREFIX}_status`] = company.status;
  if (company.research_summary) props[`${APP_PREFIX}_research_summary`] = company.research_summary;
  if (company.company_type) props[`${APP_PREFIX}_company_type`] = company.company_type;
  if (company.tool_primary) props[`${APP_PREFIX}_tool_primary`] = company.tool_primary;
  if (company.tool_secondary) props[`${APP_PREFIX}_tool_secondary`] = company.tool_secondary;

  try {
    let hubspotCompanyId = company.hubspot_company_id;
    let created = false;

    if (hubspotCompanyId) {
      // Ya existe → actualizar
      await updateHubspotCompany(hubspotCompanyId, props);
    } else {
      // Buscar por dominio primero
      const domain = props["domain"];
      if (domain) {
        const existing = await searchHubspotCompanyByDomain(domain);
        if (existing) {
          hubspotCompanyId = existing.id;
          await updateHubspotCompany(hubspotCompanyId, props);
        }
      }

      if (!hubspotCompanyId) {
        const created_ = await createHubspotCompany(props);
        hubspotCompanyId = created_.id;
        created = true;
      }
    }

    // Actualizar Supabase
    await db
      .from("companies")
      .update({
        hubspot_company_id: hubspotCompanyId,
        hubspot_synced_at: new Date().toISOString(),
        hubspot_sync_error: null,
      })
      .eq("id", companyId);

    return { ok: true, hubspotCompanyId, created };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .from("companies")
      .update({
        hubspot_sync_error: error,
        hubspot_synced_at: new Date().toISOString(),
      })
      .eq("id", companyId);
    return { ok: false, error };
  }
}

// ── Push de contacto ──────────────────────────────────────────────────────────

export type ContactHubspotPushResult =
  | { ok: true; hubspotContactId: string; created: boolean }
  | { ok: false; error: string };

export async function pushContactToHubspot(
  contactId: string
): Promise<ContactHubspotPushResult> {
  const db = supabaseAdmin();

  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, email, phone, job_title, linkedin_url, " +
        "fit_score, fit_reason, fit_action, linkedin_icebreaker, " +
        "email_subject, email_body, status, lemlist_lead_id, " +
        "hubspot_contact_id, company_id"
    )
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr || !contact) {
    return {
      ok: false,
      error: contactErr?.message ?? "Contacto no encontrado",
    };
  }

  // Asegurar que la empresa esté en HubSpot primero
  const { data: company } = await db
    .from("companies")
    .select("hubspot_company_id, company_name")
    .eq("id", contact.company_id)
    .maybeSingle();

  let hubspotCompanyId = company?.hubspot_company_id ?? null;

  // Si la empresa no tiene hubspot_company_id, intentar pushearla
  if (!hubspotCompanyId && contact.company_id) {
    const companyResult = await pushCompanyToHubspot(contact.company_id);
    if (companyResult.ok) {
      hubspotCompanyId = companyResult.hubspotCompanyId;
    }
  }

  // Construir propiedades del contacto
  const props: Record<string, string> = {};

  if (contact.first_name) props["firstname"] = contact.first_name;
  if (contact.last_name) props["lastname"] = contact.last_name;
  if (contact.email) props["email"] = contact.email;
  if (contact.phone) props["phone"] = contact.phone;
  if (contact.job_title) props["jobtitle"] = contact.job_title;
  if (contact.linkedin_url) props["linkedin"] = contact.linkedin_url;
  if (company?.company_name) props["company"] = company.company_name;

  // Propiedades custom bullseye_
  props[`${APP_PREFIX}_contact_id`] = contactId;
  if (contact.fit_score != null) props[`${APP_PREFIX}_fit_score`] = String(contact.fit_score);
  if (contact.fit_reason) props[`${APP_PREFIX}_fit_reason`] = contact.fit_reason;
  if (contact.fit_action) props[`${APP_PREFIX}_fit_action`] = contact.fit_action;
  if (contact.linkedin_icebreaker) props[`${APP_PREFIX}_linkedin_icebreaker`] = contact.linkedin_icebreaker;
  if (contact.email_subject) props[`${APP_PREFIX}_email_subject`] = contact.email_subject;
  if (contact.email_body) props[`${APP_PREFIX}_email_body`] = contact.email_body;
  if (contact.status) props[`${APP_PREFIX}_status`] = contact.status;
  if (contact.lemlist_lead_id) props[`${APP_PREFIX}_lemlist_lead_id`] = contact.lemlist_lead_id;

  try {
    let hubspotContactId = contact.hubspot_contact_id;
    let created = false;

    if (hubspotContactId) {
      await updateHubspotContact(hubspotContactId, props);
    } else {
      // Buscar por email si lo tiene
      if (contact.email) {
        const existing = await searchHubspotContactByEmail(contact.email);
        if (existing) {
          hubspotContactId = existing.id;
          await updateHubspotContact(hubspotContactId, props);
        }
      }

      if (!hubspotContactId) {
        const created_ = await createHubspotContact(props);
        hubspotContactId = created_.id;
        created = true;
      }
    }

    // Asociar con empresa en HubSpot
    if (hubspotCompanyId) {
      try {
        await associateContactToCompany(hubspotContactId, hubspotCompanyId);
      } catch {
        // No bloquear el push si la asociación falla
      }
    }

    // Actualizar Supabase
    await db
      .from("contacts")
      .update({
        hubspot_contact_id: hubspotContactId,
        hubspot_synced_at: new Date().toISOString(),
        hubspot_sync_error: null,
      })
      .eq("id", contactId);

    return { ok: true, hubspotContactId, created };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .from("contacts")
      .update({
        hubspot_sync_error: error,
        hubspot_synced_at: new Date().toISOString(),
      })
      .eq("id", contactId);
    return { ok: false, error };
  }
}
