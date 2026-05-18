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
import { computeEngagementScore } from "./contactEngagement";

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
    if (c.status === 409) {
      const existingId = extractExistingHubSpotId(c.error);
      if (existingId) {
        const r = await updateObject("companies", existingId, properties);
        if (!r.ok) {
          await persistCompanyError(db, company.id, `update-after-409: ${r.error}`);
          return { ok: false, error: r.error, status: r.status, debug: r.debug };
        }
        await persistCompanySuccess(db, company.id, existingId);
        return { ok: true, hubspot_id: existingId, created: false };
      }
    }
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
  phone_enrichment_status?: string | null;
  phone_source?: string | null;
  hubspot_contact_id?: string | null;
};

// Snapshot mínimo de la empresa para denormalizar campos al contacto.
// Lo pasa el caller (decision endpoint, retry endpoint) cuando ya tiene
// la row de companies cargada — evita un segundo fetch acá adentro.
export type HubSpotCompanySnapshot = {
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
};

export async function pushContactToHubSpot(
  db: SupabaseClient,
  contact: HubSpotContactInput,
  hubspotCompanyId: string | null,
  companySnapshot: HubSpotCompanySnapshot | null = null
): Promise<HubSpotPushResult> {
  const props = await ensureContactProperties();
  if (!props.ok && props.errors.length > 0) {
    console.warn("HubSpot contact properties failed to ensure:", props.errors);
  }

  const properties = buildContactProperties(contact, companySnapshot);

  // Engagement score (0-100) calculado on the fly desde lemlist_activities
  // + calls. Best-effort: si falla, no rompemos el push. Ver
  // lib/contactEngagement.ts para la fórmula.
  try {
    const eng = await computeEngagementScore(db, contact.id);
    properties.wecad_engagement_score = eng.score;
    if (eng.last_activity_at) {
      properties.wecad_last_engagement_at = eng.last_activity_at;
    }
  } catch {
    // ignore — el push sigue sin score actualizado.
  }

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

  // 5) No existe → create. Los contactos nuevos entran con lead status
  // "NEW" para que caigan en las listas dinámicas de HubSpot (las listas
  // "Hot/Warm por llamar" y "sin teléfono" filtran hs_lead_status = NEW).
  // Solo en el create: en los PATCH de arriba NO tocamos hs_lead_status
  // para no pisar el progreso que el SDR ya hizo sobre el contacto.
  const c = await createObject("contacts", { ...properties, hs_lead_status: "NEW" });
  if (!c.ok) {
    // 409 Conflict: HubSpot devuelve "Contact already exists. Existing ID: NNNN"
    // cuando otro pipeline (Lemlist sync nativa, import manual, etc.) creó el
    // contacto con el mismo email entre nuestra search del paso 3 y el create
    // de acá. En vez de fallar, parseamos el ID y hacemos PATCH para
    // sincronizar nuestras properties wecad_* en el contacto existente.
    if (c.status === 409) {
      const existingId = extractExistingHubSpotId(c.error);
      if (existingId) {
        const r = await updateObject("contacts", existingId, properties);
        if (!r.ok) {
          await persistContactError(db, contact.id, `update-after-409: ${r.error}`);
          return { ok: false, error: r.error, status: r.status, debug: r.debug };
        }
        await persistContactSuccess(db, contact.id, existingId);
        if (hubspotCompanyId) await associateContactCompany(existingId, hubspotCompanyId);
        return { ok: true, hubspot_id: existingId, created: false };
      }
    }
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

// Parsea "Existing ID: 1447457" del mensaje de error 409 de HubSpot.
function extractExistingHubSpotId(error: string): string | null {
  const m = /Existing\s*ID:\s*(\d+)/i.exec(error);
  return m ? m[1] : null;
}

function buildContactProperties(
  c: HubSpotContactInput,
  company: HubSpotCompanySnapshot | null
): HubSpotProperties {
  const props: HubSpotProperties = {
    wecad_contact_id: c.id
  };
  if (company?.cad_software) props.wecad_cad_software = company.cad_software;
  if (company?.company_type) props.wecad_company_type = company.company_type;
  if (company?.scanner_technology) {
    props.wecad_scanner_technology = company.scanner_technology;
  }
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
  if (c.phone_enrichment_status) {
    props.wecad_phone_enrichment_status = c.phone_enrichment_status;
  }
  if (c.phone_source) props.wecad_phone_source = c.phone_source;
  if (c.phone) props.phone = c.phone;
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
