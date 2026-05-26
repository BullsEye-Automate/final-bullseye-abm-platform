import type { SupabaseClient } from "@supabase/supabase-js";
import { associateContactCompany, createObject, searchByProperty, updateObject, type HubSpotProperties } from "./hubspot";
import { ensureCompanyProperties, ensureContactProperties } from "./hubspotProperties";
import { computeEngagementScore } from "./contactEngagement";
import { getClientLemlistCampaignId } from "./lemlistCampaigns";

const APP_PREFIX = "bullseye";

export type HubSpotPushOk = { ok: true; hubspot_id: string; created: boolean };
export type HubSpotPushErr = { ok: false; error: string; status?: number; debug?: unknown };
export type HubSpotPushResult = HubSpotPushOk | HubSpotPushErr;

export type HubSpotCompanyInput = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: string | null;
  tool_primary: string | null;
  tool_secondary: string | null;
  fit_signals: string | null;
  fit_score: string | null;
  approved_at: string | null;
  clay_pushed_at: string | null;
  hubspot_company_id?: string | null;
};

export async function pushCompanyToHubSpot(db: SupabaseClient, company: HubSpotCompanyInput): Promise<HubSpotPushResult> {
  const props = await ensureCompanyProperties();
  if (!props.ok && props.errors.length > 0) console.warn("HubSpot company properties failed:", props.errors);

  const properties = buildCompanyProperties(company);

  if (company.hubspot_company_id) {
    const r = await updateObject("companies", company.hubspot_company_id, properties);
    if (r.ok) { await persistCompanySuccess(db, company.id, company.hubspot_company_id); return { ok: true, hubspot_id: company.hubspot_company_id, created: false }; }
    if (r.status !== 404) { await persistCompanyError(db, company.id, `update: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
  }

  const search = await searchByProperty("companies", `${APP_PREFIX}_company_id`, company.id);
  if (search.ok && search.data && search.data.total > 0) {
    const hubspotId = search.data.results[0].id;
    const r = await updateObject("companies", hubspotId, properties);
    if (!r.ok) { await persistCompanyError(db, company.id, `update-after-search: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
    await persistCompanySuccess(db, company.id, hubspotId);
    return { ok: true, hubspot_id: hubspotId, created: false };
  }

  const c = await createObject("companies", properties);
  if (!c.ok) {
    if (c.status === 409) {
      const existingId = extractExistingHubSpotId(c.error);
      if (existingId) {
        const r = await updateObject("companies", existingId, properties);
        if (!r.ok) { await persistCompanyError(db, company.id, `update-after-409: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
        await persistCompanySuccess(db, company.id, existingId);
        return { ok: true, hubspot_id: existingId, created: false };
      }
    }
    await persistCompanyError(db, company.id, `create: ${c.error}`);
    return { ok: false, error: c.error, status: c.status, debug: c.debug };
  }
  const hubspotId = c.data?.id ?? "";
  if (!hubspotId) { await persistCompanyError(db, company.id, "create: empty id in response"); return { ok: false, error: "HubSpot returned no id", debug: c.data }; }
  await persistCompanySuccess(db, company.id, hubspotId);
  return { ok: true, hubspot_id: hubspotId, created: true };
}

function buildCompanyProperties(c: HubSpotCompanyInput): HubSpotProperties {
  const props: HubSpotProperties = { name: c.company_name, [`${APP_PREFIX}_company_id`]: c.id };
  if (c.company_website) { props.website = c.company_website; props.domain = extractDomain(c.company_website); }
  if (c.company_linkedin_url) props.linkedin_company_page = c.company_linkedin_url;
  if (c.company_city) props.city = c.company_city;
  if (c.company_country) props.country = c.company_country;
  if (c.company_size != null) props.numberofemployees = c.company_size;
  if (c.company_type) props[`${APP_PREFIX}_company_type`] = c.company_type;
  if (c.tool_primary) props[`${APP_PREFIX}_tool_primary`] = c.tool_primary;
  if (c.tool_secondary) props[`${APP_PREFIX}_tool_secondary`] = c.tool_secondary;
  if (c.fit_signals) props[`${APP_PREFIX}_fit_signals`] = c.fit_signals;
  if (c.fit_score) props[`${APP_PREFIX}_company_fit_score`] = c.fit_score;
  if (c.approved_at) props[`${APP_PREFIX}_approved_at`] = c.approved_at;
  if (c.clay_pushed_at) props[`${APP_PREFIX}_clay_pushed_at`] = c.clay_pushed_at;
  return props;
}

async function persistCompanySuccess(db: SupabaseClient, companyId: string, hubspotId: string) {
  await db.from("companies").update({ hubspot_company_id: hubspotId, hubspot_synced_at: new Date().toISOString(), hubspot_sync_error: null }).eq("id", companyId);
}
async function persistCompanyError(db: SupabaseClient, companyId: string, error: string) {
  await db.from("companies").update({ hubspot_sync_error: error }).eq("id", companyId);
}

export type HubSpotContactInput = {
  id: string;
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
  client_id?: string | null;
};

export type HubSpotCompanySnapshot = { company_type: string | null; tool_primary: string | null; tool_secondary: string | null };

export async function pushContactToHubSpot(db: SupabaseClient, contact: HubSpotContactInput, hubspotCompanyId: string | null, companySnapshot: HubSpotCompanySnapshot | null = null): Promise<HubSpotPushResult> {
  const props = await ensureContactProperties();
  if (!props.ok && props.errors.length > 0) console.warn("HubSpot contact properties failed:", props.errors);

  const properties = buildContactProperties(contact, companySnapshot);

  // Engagement score best-effort
  try {
    const eng = await computeEngagementScore(db, contact.id);
    properties[`${APP_PREFIX}_engagement_score`] = eng.score;
    if (eng.last_activity_at) properties[`${APP_PREFIX}_last_engagement_at`] = eng.last_activity_at;
  } catch { /* ignorar */ }

  // Lemlist campaign ID
  const campaignId = await getClientLemlistCampaignId(db, contact.client_id ?? null);
  if (campaignId) properties[`${APP_PREFIX}_lemlist_campaign`] = campaignId;

  if (contact.hubspot_contact_id) {
    const r = await updateObject("contacts", contact.hubspot_contact_id, properties);
    if (r.ok) { await persistContactSuccess(db, contact.id, contact.hubspot_contact_id); if (hubspotCompanyId) await associateContactCompany(contact.hubspot_contact_id, hubspotCompanyId); return { ok: true, hubspot_id: contact.hubspot_contact_id, created: false }; }
    if (r.status !== 404) { await persistContactError(db, contact.id, `update: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
  }

  let hubspotId: string | null = null;
  const searchByOurId = await searchByProperty("contacts", `${APP_PREFIX}_contact_id`, contact.id);
  if (searchByOurId.ok && searchByOurId.data && searchByOurId.data.total > 0) hubspotId = searchByOurId.data.results[0].id;

  if (!hubspotId && contact.email) {
    const searchByEmail = await searchByProperty("contacts", "email", contact.email);
    if (searchByEmail.ok && searchByEmail.data && searchByEmail.data.total > 0) hubspotId = searchByEmail.data.results[0].id;
  }

  if (hubspotId) {
    const r = await updateObject("contacts", hubspotId, properties);
    if (!r.ok) { await persistContactError(db, contact.id, `update-after-search: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
    await persistContactSuccess(db, contact.id, hubspotId);
    if (hubspotCompanyId) await associateContactCompany(hubspotId, hubspotCompanyId);
    return { ok: true, hubspot_id: hubspotId, created: false };
  }

  const c = await createObject("contacts", { ...properties, hs_lead_status: "NEW" });
  if (!c.ok) {
    if (c.status === 409) {
      const existingId = extractExistingHubSpotId(c.error);
      if (existingId) {
        const r = await updateObject("contacts", existingId, properties);
        if (!r.ok) { await persistContactError(db, contact.id, `update-after-409: ${r.error}`); return { ok: false, error: r.error, status: r.status, debug: r.debug }; }
        await persistContactSuccess(db, contact.id, existingId);
        if (hubspotCompanyId) await associateContactCompany(existingId, hubspotCompanyId);
        return { ok: true, hubspot_id: existingId, created: false };
      }
    }
    await persistContactError(db, contact.id, `create: ${c.error}`);
    return { ok: false, error: c.error, status: c.status, debug: c.debug };
  }
  const newId = c.data?.id ?? "";
  if (!newId) { await persistContactError(db, contact.id, "create: empty id in response"); return { ok: false, error: "HubSpot returned no id", debug: c.data }; }
  await persistContactSuccess(db, contact.id, newId);
  if (hubspotCompanyId) await associateContactCompany(newId, hubspotCompanyId);
  return { ok: true, hubspot_id: newId, created: true };
}

function buildContactProperties(c: HubSpotContactInput, company: HubSpotCompanySnapshot | null): HubSpotProperties {
  const props: HubSpotProperties = { [`${APP_PREFIX}_contact_id`]: c.id };
  if (company?.tool_primary) props[`${APP_PREFIX}_tool_primary`] = company.tool_primary;
  if (company?.company_type) props[`${APP_PREFIX}_company_type`] = company.company_type;
  if (company?.tool_secondary) props[`${APP_PREFIX}_tool_secondary`] = company.tool_secondary;
  if (c.first_name) props.firstname = c.first_name;
  if (c.last_name) props.lastname = c.last_name;
  if (c.email) props.email = c.email;
  if (c.phone) props.phone = c.phone;
  if (c.job_title) props.jobtitle = c.job_title;
  if (c.linkedin_url) props.hs_linkedinid = c.linkedin_url;
  if (c.fit_score != null) props[`${APP_PREFIX}_fit_score`] = c.fit_score;
  if (c.fit_reason) props[`${APP_PREFIX}_fit_reason`] = c.fit_reason;
  if (c.fit_action) props[`${APP_PREFIX}_fit_action`] = c.fit_action;
  if (c.human_decision) props[`${APP_PREFIX}_human_decision`] = c.human_decision;
  if (c.human_decision_reason) props[`${APP_PREFIX}_human_decision_reason`] = c.human_decision_reason;
  if (c.linkedin_icebreaker) props[`${APP_PREFIX}_linkedin_icebreaker`] = c.linkedin_icebreaker;
  if (c.email_subject) props[`${APP_PREFIX}_email_subject`] = c.email_subject;
  if (c.email_body) props[`${APP_PREFIX}_email_body`] = c.email_body;
  if (c.clay_pushed_at) props[`${APP_PREFIX}_clay_pushed_at`] = c.clay_pushed_at;
  if (c.lemlist_pushed_at) props[`${APP_PREFIX}_lemlist_pushed_at`] = c.lemlist_pushed_at;
  if (c.phone_enrichment_status) props[`${APP_PREFIX}_phone_enrichment_status`] = c.phone_enrichment_status;
  if (c.phone_source) props[`${APP_PREFIX}_phone_source`] = c.phone_source;
  return props;
}

async function persistContactSuccess(db: SupabaseClient, contactId: string, hubspotId: string) {
  await db.from("contacts").update({ hubspot_contact_id: hubspotId, hubspot_synced_at: new Date().toISOString(), hubspot_sync_error: null }).eq("id", contactId);
}
async function persistContactError(db: SupabaseClient, contactId: string, error: string) {
  await db.from("contacts").update({ hubspot_sync_error: error }).eq("id", contactId);
}

function extractExistingHubSpotId(error: string): string | null {
  const m = /Existing\s*ID:\s*(\d+)/i.exec(error);
  return m ? m[1] : null;
}

function extractDomain(url: string): string | undefined {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return undefined; }
}
