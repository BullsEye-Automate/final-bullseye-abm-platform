// Definición de propiedades custom de HubSpot con prefijo bullseye_.
// Incluye helpers para crear el grupo y las propiedades en HubSpot si no existen.

import { hubspotRequest } from "@/lib/hubspot";

export const APP_PREFIX = "bullseye";
export const GROUP_NAME = "bullseye";
export const GROUP_LABEL = "BullsEye";

export type HubSpotPropertyDef = {
  name: string;
  label: string;
  type: "string" | "number" | "enumeration" | "bool" | "date" | "datetime";
  fieldType: "text" | "textarea" | "number" | "select" | "booleancheckbox" | "date";
  groupName: string;
  objectType: "contacts" | "companies";
  options?: { label: string; value: string; displayOrder: number }[];
};

// ── Propiedades de contactos ──────────────────────────────────────────────────

export const CONTACT_PROPERTIES: HubSpotPropertyDef[] = [
  {
    name: `${APP_PREFIX}_contact_id`,
    label: "BullsEye Contact ID",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_fit_score`,
    label: "BullsEye Fit Score",
    type: "number",
    fieldType: "number",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_fit`,
    label: "BullsEye Fit",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    objectType: "contacts",
    options: [
      { label: "High", value: "high", displayOrder: 0 },
      { label: "Medium", value: "medium", displayOrder: 1 },
      { label: "Low", value: "low", displayOrder: 2 },
    ],
  },
  {
    name: `${APP_PREFIX}_fit_reason`,
    label: "BullsEye Fit Reason",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_fit_action`,
    label: "BullsEye Fit Action",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    objectType: "contacts",
    options: [
      { label: "Enrich", value: "enrich", displayOrder: 0 },
      { label: "Manual Review", value: "manual_review", displayOrder: 1 },
      { label: "Discard", value: "discard", displayOrder: 2 },
    ],
  },
  {
    name: `${APP_PREFIX}_linkedin_icebreaker`,
    label: "BullsEye LinkedIn Icebreaker",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_email_subject`,
    label: "BullsEye Email Subject",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_email_body`,
    label: "BullsEye Email Body",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
  {
    name: `${APP_PREFIX}_status`,
    label: "BullsEye Status",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    objectType: "contacts",
    options: [
      { label: "Pending", value: "pending", displayOrder: 0 },
      { label: "Enriched", value: "enriched", displayOrder: 1 },
      { label: "Contacted", value: "contacted", displayOrder: 2 },
      { label: "Replied", value: "replied", displayOrder: 3 },
      { label: "Discarded", value: "discarded", displayOrder: 4 },
    ],
  },
  {
    name: `${APP_PREFIX}_lemlist_lead_id`,
    label: "BullsEye Lemlist Lead ID",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "contacts",
  },
];

// ── Propiedades de empresas ───────────────────────────────────────────────────

export const COMPANY_PROPERTIES: HubSpotPropertyDef[] = [
  {
    name: `${APP_PREFIX}_company_id`,
    label: "BullsEye Company ID",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "companies",
  },
  {
    name: `${APP_PREFIX}_fit_score`,
    label: "BullsEye Fit Score",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    objectType: "companies",
    options: [
      { label: "High", value: "high", displayOrder: 0 },
      { label: "Medium", value: "medium", displayOrder: 1 },
      { label: "Low", value: "low", displayOrder: 2 },
    ],
  },
  {
    name: `${APP_PREFIX}_status`,
    label: "BullsEye Status",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    objectType: "companies",
    options: [
      { label: "Pending", value: "pending", displayOrder: 0 },
      { label: "Approved", value: "approved", displayOrder: 1 },
      { label: "Rejected", value: "rejected", displayOrder: 2 },
    ],
  },
  {
    name: `${APP_PREFIX}_research_summary`,
    label: "BullsEye Research Summary",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    objectType: "companies",
  },
  {
    name: `${APP_PREFIX}_company_type`,
    label: "BullsEye Company Type",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "companies",
  },
  {
    name: `${APP_PREFIX}_tool_primary`,
    label: "BullsEye Tool Primary",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "companies",
  },
  {
    name: `${APP_PREFIX}_tool_secondary`,
    label: "BullsEye Tool Secondary",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    objectType: "companies",
  },
];

// ── Helpers para crear grupo y propiedades en HubSpot ────────────────────────

async function ensurePropertyGroup(objectType: "contacts" | "companies"): Promise<void> {
  try {
    await hubspotRequest(
      "POST",
      `/crm/v3/properties/${objectType}/groups`,
      { name: GROUP_NAME, label: GROUP_LABEL, displayOrder: 1 }
    );
  } catch (err: unknown) {
    // El grupo ya existe — ignorar el error 409
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("409") && !msg.includes("already exists") && !msg.includes("CONFLICT")) {
      throw err;
    }
  }
}

async function ensureProperty(def: HubSpotPropertyDef): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      name: def.name,
      label: def.label,
      type: def.type,
      fieldType: def.fieldType,
      groupName: def.groupName,
    };
    if (def.options) body["options"] = def.options;

    await hubspotRequest(
      "POST",
      `/crm/v3/properties/${def.objectType}`,
      body
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("409") && !msg.includes("already exists") && !msg.includes("CONFLICT")) {
      throw err;
    }
  }
}

/**
 * Asegura que el grupo BullsEye y todas las propiedades custom existen en HubSpot.
 * Llama esto una vez durante el setup o antes del primer push.
 */
export async function ensureBullseyeProperties(): Promise<void> {
  // Crear grupos
  await ensurePropertyGroup("contacts");
  await ensurePropertyGroup("companies");

  // Crear propiedades de contactos
  for (const prop of CONTACT_PROPERTIES) {
    await ensureProperty(prop);
  }

  // Crear propiedades de empresas
  for (const prop of COMPANY_PROPERTIES) {
    await ensureProperty(prop);
  }
}
