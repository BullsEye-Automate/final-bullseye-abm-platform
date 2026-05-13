// Orquesta el push de contactos y empresas a HubSpot. Sprint 4.
//
// Estrategia de idempotencia:
//   - Empresa: si companies.hubspot_company_id está set → PATCH directo.
//     Si no, search por wecad_company_id (nuestro UUID). Si encontramos
//     match → PATCH + persist id. Si no → POST y persist id.
//   - Contacto: mismo patrón con wecad_contact_id como identifier.
//     Como fallback adicional, si hay email, también search por email
//     (Lemlist integration crea contactos por email — queremos reusar
//     esos en vez de duplicar).
//
// Las propiedades custom wecad_* se aseguran (idempotente, módulo cached)
// en el primer push del proceso. Si falla la creación, el push sigue con
// los standard fields y registra el error en hubspot_sync_error.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  associateContactCompany,
  createObject,
  searchByProperty,
  updateObject,
  type HubSpotProperties
} from "./hubspot";
import { ensureCompanyProperties, ensureContactProperties } from "./hubspotProperties";

export type HubSpotPushOk = {
  ok: true;
  hubspot_id: string;
  created: boolean; // true si POST, false si PATCH
};

export type HubSpotPushErr = {
  ok: false;
  error: string;
  status?: number;
  debug?: unknown;
};

export type HubSpotPushResult = HubSpotPushOk | HubSpotPushErr;

// ============================================================================
// Push de empresa
// ============================================================================

export type HubSpotCompanyInput = {
  id: string; // UUID Supabase
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  fit_score: string | null; // 'high' / 'medium' / 'low'
  approved_at: string | null;
  clay_pushed_at: string | null;
  hubspot_company_id?: string | null;
};

export async function pushCompanyToHubSpot(
  db: SupabaseClient,
  company: HubSpotCompanyInput
): Promise<HubSpotPushResult> {
  // 1) Asegurar custom props (idempotente, cached).
  const props = await ensureCompanyProperties();
  if (!props.ok && props.errors.length > 0) {
    // No bloqueamos el push si la creación de alguna prop falló — el upsert
    // con campos estándar todavía puede funcionar. Pero registramos.
    console.warn("HubSpot company properties failed to ensure:", props.errors);
  }

  const properties = buildCompanyProperties(company);

  // 2) Si ya tenemos hubspot_company_id, PATCH directo.
  if (company.hubspot_company_id) {
    const r = await updateObject("companies", company.hubspot_company_id, properties);
    if (r.ok) {
      await persistCompanySuccess(db, company.id, company.hubspot_company_id);
      return { ok: true, hubspot_id: company.hubspot_company_id, created: false };
    }
    // Si fallo 404 (id ya no existe) limpiamos y reintentamos search.
    if (r.status !== 404) {
      await persistCompanyError(db, company.id, `update: ${r.error}`);
      return { ok: false, error: r.error, status: r.status, debug: r.debug };
    }
  }

  // 3) Search por wecad_company_id.
  const search = await searchByProperty("companies", "wecad_company_id", company.id);
  if (search.ok && search.data && search.data.total > 0) {
    const hubspotId = search.data.results[0].id;
    const r = await updateObject("companies", hubspotId, properties);
    if (!r.ok) {
      await persistCompanyError(db, company.id, `update-after-search: ${r.error}`);
      return { ok: false, error: r.error, status: r.status, debug: r.debug };
    }
    await persistCompanySuccess(db, company.id, hubspotId);
    return { ok: true, hubspot_id: hubspotId, created: false };
  }

  // 4) No existe → create.
  const c = await createObject("companies", properties);
  if (!c.ok) {
    await persistCompanyError(db, company.id, `create: ${c.error}`);
    return { ok: false, error: c.error, status: c.status, debug: c.debug };
  }
  const hubspotId = c.data?.id ?? "";
  if (!hubspotId) {
    await persistCompanyError(db, company.id, "create: empty id in response");
    return { ok: false, error: "HubSpot returned no id", debug: c.data };
  }
  await persistCompanySuccess(db, company.id, hubspotId);
  return { ok: true, hubspot_id: hubspotId, created: true };
}

function buildCompanyProperties(c: HubSpotCompanyInput): HubSpotProperties {
  const props: HubSpotProperties = {
    name: c.company_name,
    wecad_company_id: c.id
  };
  if (c.company_website) {
    props.website = c.company_website;
    props.domain = extractDomain(c.company_website);
  }
  if (c.company_linkedin_url) props.linkedin_company_page = c.company_linkedin_url;
  if (c.company_city) props.city = c.company_city;
  if (c.company_country) props.country = c.company_country;
  if (c.company_size != null) props.numberofemployees = c.company_size;
  if (c.company_type) props.wecad_company_type = c.company_type;
  if (c.cad_software) props.wecad_cad_software = c.cad_software;
  if (c.scanner_technology) props.wecad_scanner_technology = c.scanner_technology;
  if (c.fit_signals) props.wecad_fit_signals = c.fit_signals;
  if (c.fit_score) props.wecad_company_fit_score = c.fit_score;
  if (c.approved_at) props.wecad_approved_at = c.approved_at;
  if (c.clay_pushed_at) props.wecad_clay_pushed_at = c.clay_pushed_at;
  return props;
}

async function persistCompanySuccess(
  db: SupabaseClient,
  companyId: string,
  hubspotId: string
) {
  await db
    .from("companies")
    .update({
      hubspot_company_id: hubspotId,
      hubspot_synced_at: new Date().toISOString(),
      hubspot_sync_error: null
    })
    .eq("id", companyId);
}

async function persistCompanyError(
  db: SupabaseClient,
  companyId: string,
  error: string
) {
  await db
    .from("companies")
    .update({ hubspot_sync_error: error })
    .eq("id", companyId);
}

// ============================================================================
// Push de contacto
// ============================================================================

export type HubSpotContactInput = {
  id: string; // UUID Supabase
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  fit_action: string | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
  human_decision: string | null;
  human_decision_reason: string | null;
  clay_pushed_at: string | null;
  lemlist_pushed_at: string | null;
  hubspot_contact_id?: string | null;
};

export async function pushContactToHubSpot(
  db: SupabaseClient,
  contact: HubSpotContactInput,
  hubspotCompanyId: string | null
): Promise<HubSpotPushResult> {
  const props = await ensureContactProperties();
  if (!props.ok && props.errors.length > 0) {
    console.warn("HubSpot contact properties failed to ensure:", props.errors);
  }

  const properties = buildContactProperties(contact);

  // 1) hubspot_contact_id ya conocido → PATCH directo.
  if (contact.hubspot_contact_id) {
    const r = await updateObject("contacts", contact.hubspot_contact_id, properties);
    if (r.ok) {
      await persistContactSuccess(db, contact.id, contact.hubspot_contact_id);
      if (hubspotCompanyId) {
        await associateContactCompany(contact.hubspot_contact_id, hubspotCompanyId);
      }
      return { ok: true, hubspot_id: contact.hubspot_contact_id, created: false };
    }
    if (r.status !== 404) {
      await persistContactError(db, contact.id, `update: ${r.error}`);
      return { ok: false, error: r.error, status: r.status, debug: r.debug };
    }
  }

  // 2) Search por wecad_contact_id.
  let hubspotId: string | null = null;
  const searchByOurId = await searchByProperty("contacts", "wecad_contact_id", contact.id);
  if (searchByOurId.ok && searchByOurId.data && searchByOurId.data.total > 0) {
    hubspotId = searchByOurId.data.results[0].id;
  }

  // 3) Fallback: si hay email, search por email (Lemlist puede haber creado
  //    el contacto via su integración antes de que la app pushee).
  if (!hubspotId && contact.email) {
    const searchByEmail = await searchByProperty("contacts", "email", contact.email);
    if (searchByEmail.ok && searchByEmail.data && searchByEmail.data.total > 0) {
      hubspotId = searchByEmail.data.results[0].id;
    }
  }

  // 4) Existe → PATCH.
  if (hubspotId) {
    const r = await updateObject("contacts", hubspotId, properties);
    if (!r.ok) {
      await persistContactError(db, contact.id, `update-after-search: ${r.error}`);
      return { ok: false, error: r.error, status: r.status, debug: r.debug };
    }
    await persistContactSuccess(db, contact.id, hubspotId);
    if (hubspotCompanyId) await associateContactCompany(hubspotId, hubspotCompanyId);
    return { ok: true, hubspot_id: hubspotId, created: false };
  }

  // 5) No existe → create.
  const c = await createObject("contacts", properties);
  if (!c.ok) {
    await persistContactError(db, contact.id, `create: ${c.error}`);
    return { ok: false, error: c.error, status: c.status, debug: c.debug };
  }
  const newId = c.data?.id ?? "";
  if (!newId) {
    await persistContactError(db, contact.id, "create: empty id in response");
    return { ok: false, error: "HubSpot returned no id", debug: c.data };
  }
  await persistContactSuccess(db, contact.id, newId);
  if (hubspotCompanyId) await associateContactCompany(newId, hubspotCompanyId);
  return { ok: true, hubspot_id: newId, created: true };
}

function buildContactProperties(c: HubSpotContactInput): HubSpotProperties {
  const props: HubSpotProperties = {
    wecad_contact_id: c.id
  };
  if (c.first_name) props.firstname = c.first_name;
  if (c.last_name) props.lastname = c.last_name;
  if (c.email) props.email = c.email;
  if (c.phone) props.phone = c.phone;
  if (c.job_title) props.jobtitle = c.job_title;
  if (c.linkedin_url) props.hs_linkedinid = c.linkedin_url;
  if (c.fit_score != null) props.wecad_fit_score = c.fit_score;
  if (c.fit_reason) props.wecad_fit_reason = c.fit_reason;
  if (c.fit_action) props.wecad_fit_action = c.fit_action;
  if (c.human_decision) props.wecad_human_decision = c.human_decision;
  if (c.human_decision_reason) props.wecad_human_decision_reason = c.human_decision_reason;
  if (c.linkedin_icebreaker) props.wecad_linkedin_icebreaker = c.linkedin_icebreaker;
  if (c.email_subject) props.wecad_email_subject = c.email_subject;
  if (c.email_body) props.wecad_email_body = c.email_body;
  if (c.clay_pushed_at) props.wecad_clay_pushed_at = c.clay_pushed_at;
  if (c.lemlist_pushed_at) props.wecad_lemlist_pushed_at = c.lemlist_pushed_at;
  if (process.env.LEMLIST_CAMPAIGN_ID) {
    props.wecad_lemlist_campaign = process.env.LEMLIST_CAMPAIGN_ID;
  }
  return props;
}

async function persistContactSuccess(
  db: SupabaseClient,
  contactId: string,
  hubspotId: string
) {
  await db
    .from("contacts")
    .update({
      hubspot_contact_id: hubspotId,
      hubspot_synced_at: new Date().toISOString(),
      hubspot_sync_error: null
    })
    .eq("id", contactId);
}

async function persistContactError(
  db: SupabaseClient,
  contactId: string,
  error: string
) {
  await db
    .from("contacts")
    .update({ hubspot_sync_error: error })
    .eq("id", contactId);
}

function extractDomain(url: string): string | undefined {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
