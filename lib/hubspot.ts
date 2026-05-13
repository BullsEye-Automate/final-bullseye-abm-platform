// Cliente HubSpot CRM v3. Usado por la app para crear/actualizar contactos
// y empresas en HubSpot cuando se aprueban desde la app. Sprint 4.
//
// Auth: Private App Access Token via Bearer (Settings → Integrations →
// Private Apps en HubSpot UI). Scopes requeridos:
//   crm.objects.contacts.read/write
//   crm.objects.companies.read/write
//   crm.schemas.contacts.read/write
//   crm.schemas.companies.read/write
//
// Idempotencia: searcheamos por email/domain antes de crear; si existe,
// PATCH. Si no, POST. La columna hubspot_*_id en Supabase guarda el id
// canónico de HubSpot para futuras updates rápidas (sin search).

const HUBSPOT_API_BASE = "https://api.hubapi.com";

export type HubSpotProperties = Record<string, string | number | null | undefined>;

export type HubSpotApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; debug?: unknown };

function authHeaders(): Record<string, string> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function hubspotFetch<T = unknown>(
  path: string,
  init: RequestInit
): Promise<HubSpotApiResult<T>> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: false, status: 500, error: "HUBSPOT_ACCESS_TOKEN is not configured" };
  }
  const url = `${HUBSPOT_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 502, error: message, debug: { url } };
  }

  const rawText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = { raw: rawText.slice(0, 600) };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `HubSpot ${res.status}`,
      debug: { url, method: init.method, response: parsed }
    };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// ============================================================================
// Properties API — usado para crear los wecad_* custom fields la primera vez.
// ============================================================================

export type PropertyType = "string" | "number" | "datetime" | "enumeration";
export type PropertyFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "date";

export type PropertyDef = {
  name: string;
  label: string;
  type: PropertyType;
  fieldType: PropertyFieldType;
  groupName: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
};

export async function listProperties(
  objectType: "contacts" | "companies"
): Promise<HubSpotApiResult<{ results: Array<{ name: string }> }>> {
  return hubspotFetch(`/crm/v3/properties/${objectType}`, { method: "GET" });
}

export async function createProperty(
  objectType: "contacts" | "companies",
  def: PropertyDef
): Promise<HubSpotApiResult> {
  const body: Record<string, unknown> = {
    name: def.name,
    label: def.label,
    type: def.type,
    fieldType: def.fieldType,
    groupName: def.groupName
  };
  if (def.description) body.description = def.description;
  if (def.options) body.options = def.options.map((o) => ({ ...o, displayOrder: -1 }));
  return hubspotFetch(`/crm/v3/properties/${objectType}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function ensureGroup(
  objectType: "contacts" | "companies",
  groupName: string,
  groupLabel: string
): Promise<HubSpotApiResult> {
  // Idempotente: list groups; si existe, no-op. Si no, crear.
  const list = await hubspotFetch<{ results: Array<{ name: string }> }>(
    `/crm/v3/properties/${objectType}/groups`,
    { method: "GET" }
  );
  if (list.ok && list.data?.results.some((g) => g.name === groupName)) {
    return { ok: true, status: 200, data: null };
  }
  return hubspotFetch(`/crm/v3/properties/${objectType}/groups`, {
    method: "POST",
    body: JSON.stringify({ name: groupName, label: groupLabel, displayOrder: -1 })
  });
}

// ============================================================================
// Contacts / Companies CRUD
// ============================================================================

type HubSpotObject = {
  id: string;
  properties: Record<string, string>;
};

// Busca por una propiedad (email para contactos, domain para empresas, o
// el id de nuestro Supabase via wecad_company_id / wecad_contact_id).
export async function searchByProperty(
  objectType: "contacts" | "companies",
  property: string,
  value: string
): Promise<HubSpotApiResult<{ total: number; results: HubSpotObject[] }>> {
  return hubspotFetch(`/crm/v3/objects/${objectType}/search`, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: property, operator: "EQ", value }]
        }
      ],
      properties: [property, "createdate"],
      limit: 1
    })
  });
}

export async function createObject(
  objectType: "contacts" | "companies",
  properties: HubSpotProperties
): Promise<HubSpotApiResult<HubSpotObject>> {
  return hubspotFetch(`/crm/v3/objects/${objectType}`, {
    method: "POST",
    body: JSON.stringify({ properties: stripUndefined(properties) })
  });
}

export async function updateObject(
  objectType: "contacts" | "companies",
  id: string,
  properties: HubSpotProperties
): Promise<HubSpotApiResult<HubSpotObject>> {
  return hubspotFetch(`/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: stripUndefined(properties) })
  });
}

// Asocia contacto ↔ empresa con el tipo de asociación default contact_to_company.
export async function associateContactCompany(
  contactId: string,
  companyId: string
): Promise<HubSpotApiResult> {
  return hubspotFetch(
    `/crm/v3/objects/contacts/${encodeURIComponent(
      contactId
    )}/associations/companies/${encodeURIComponent(companyId)}/contact_to_company`,
    { method: "PUT" }
  );
}

function stripUndefined(obj: HubSpotProperties): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    out[k] = v;
  }
  return out;
}
