import {
  createProperty,
  ensureGroup,
  listProperties,
  type PropertyDef
} from "./hubspot";

export const APP_PREFIX = "bullseye";
export const GROUP_NAME = "bullseye";
export const GROUP_LABEL = "BullsEye";

const CONTACT_PROPERTIES: PropertyDef[] = [
  { name: `${APP_PREFIX}_contact_id`, label: "BullsEye Contact ID", type: "string", fieldType: "text", groupName: GROUP_NAME, description: "UUID del contacto en Supabase." },
  { name: `${APP_PREFIX}_fit_score`, label: "BullsEye Fit Score", type: "number", fieldType: "number", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_fit_reason`, label: "BullsEye Fit Reason", type: "string", fieldType: "textarea", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_fit_action`, label: "BullsEye Fit Action", type: "enumeration", fieldType: "select", groupName: GROUP_NAME, options: [{ label: "Enrich", value: "enrich" }, { label: "Manual review", value: "manual_review" }, { label: "Discard", value: "discard" }] },
  { name: `${APP_PREFIX}_human_decision`, label: "BullsEye Human Decision", type: "enumeration", fieldType: "select", groupName: GROUP_NAME, options: [{ label: "Approved", value: "approved" }, { label: "Rejected", value: "rejected" }] },
  { name: `${APP_PREFIX}_human_decision_reason`, label: "BullsEye Human Decision Reason", type: "string", fieldType: "textarea", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_linkedin_icebreaker`, label: "BullsEye LinkedIn Icebreaker", type: "string", fieldType: "textarea", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_email_subject`, label: "BullsEye Email Subject", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_email_body`, label: "BullsEye Email Body", type: "string", fieldType: "textarea", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_clay_pushed_at`, label: "BullsEye Clay Pushed At", type: "datetime", fieldType: "date", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_lemlist_pushed_at`, label: "BullsEye Lemlist Pushed At", type: "datetime", fieldType: "date", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_lemlist_campaign`, label: "BullsEye Lemlist Campaign", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_tool_primary`, label: "BullsEye Primary Tooling", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_tool_secondary`, label: "BullsEye Secondary Tooling", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_company_type`, label: "BullsEye Company Type", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_engagement_score`, label: "BullsEye Engagement Score", type: "number", fieldType: "number", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_last_engagement_at`, label: "BullsEye Last Engagement At", type: "datetime", fieldType: "date", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_phone_enrichment_status`, label: "BullsEye Phone Enrichment Status", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_phone_source`, label: "BullsEye Phone Source", type: "string", fieldType: "text", groupName: GROUP_NAME }
];

const COMPANY_PROPERTIES: PropertyDef[] = [
  { name: `${APP_PREFIX}_company_id`, label: "BullsEye Company ID", type: "string", fieldType: "text", groupName: GROUP_NAME, description: "UUID de la empresa en Supabase." },
  { name: `${APP_PREFIX}_company_type`, label: "BullsEye Company Type", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_tool_primary`, label: "BullsEye Primary Tooling", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_tool_secondary`, label: "BullsEye Secondary Tooling", type: "string", fieldType: "text", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_fit_signals`, label: "BullsEye Fit Signals", type: "string", fieldType: "textarea", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_company_fit_score`, label: "BullsEye Company Fit Score", type: "enumeration", fieldType: "select", groupName: GROUP_NAME, options: [{ label: "High", value: "high" }, { label: "Medium", value: "medium" }, { label: "Low", value: "low" }] },
  { name: `${APP_PREFIX}_approved_at`, label: "BullsEye Approved At", type: "datetime", fieldType: "date", groupName: GROUP_NAME },
  { name: `${APP_PREFIX}_clay_pushed_at`, label: "BullsEye Clay Pushed At", type: "datetime", fieldType: "date", groupName: GROUP_NAME }
];

let ensuredContacts = false;
let ensuredCompanies = false;

export async function ensureContactProperties(opts: { force?: boolean } = {}): Promise<{ ok: boolean; created: string[]; errors: Array<{ property: string; error: string }> }> {
  if (!opts.force && ensuredContacts) return { ok: true, created: [], errors: [] };
  const result = await ensureForObject("contacts", CONTACT_PROPERTIES);
  if (result.ok) ensuredContacts = true;
  return result;
}

export async function ensureCompanyProperties(opts: { force?: boolean } = {}): Promise<{ ok: boolean; created: string[]; errors: Array<{ property: string; error: string }> }> {
  if (!opts.force && ensuredCompanies) return { ok: true, created: [], errors: [] };
  const result = await ensureForObject("companies", COMPANY_PROPERTIES);
  if (result.ok) ensuredCompanies = true;
  return result;
}

async function ensureForObject(objectType: "contacts" | "companies", definitions: PropertyDef[]): Promise<{ ok: boolean; created: string[]; errors: Array<{ property: string; error: string }> }> {
  const created: string[] = [];
  const errors: Array<{ property: string; error: string }> = [];

  const groupRes = await ensureGroup(objectType, GROUP_NAME, GROUP_LABEL);
  if (!groupRes.ok) {
    return { ok: false, created, errors: [{ property: `[group ${GROUP_NAME}]`, error: groupRes.error }] };
  }

  const list = await listProperties(objectType);
  if (!list.ok) {
    return { ok: false, created, errors: [{ property: "[listProperties]", error: list.error }] };
  }
  const existing = new Set(list.data?.results.map((r) => r.name) ?? []);

  for (const def of definitions) {
    if (existing.has(def.name)) continue;
    const res = await createProperty(objectType, def);
    if (res.ok) created.push(def.name);
    else errors.push({ property: def.name, error: res.error });
  }

  return { ok: errors.length === 0, created, errors };
}

export async function ensureBullseyeProperties(): Promise<void> {
  await ensureContactProperties({ force: true });
  await ensureCompanyProperties({ force: true });
}
