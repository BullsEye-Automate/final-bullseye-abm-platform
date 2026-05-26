// Auth: Private App Access Token via Bearer.
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
    const p = parsed as Record<string, unknown> | null;
    const baseMsg =
      (typeof p?.message === "string" && p.message) ||
      JSON.stringify(parsed ?? {}).slice(0, 300);
    const errorsArr = Array.isArray(p?.errors) ? (p.errors as Array<Record<string, unknown>>) : [];
    const detail = errorsArr
      .slice(0, 3)
      .map((e) => {
        const m = typeof e.message === "string" ? e.message : "";
        const ctx = e.context ? ` (${JSON.stringify(e.context).slice(0, 120)})` : "";
        return `${m}${ctx}`;
      })
      .filter(Boolean)
      .join(" · ");
    return {
      ok: false,
      status: res.status,
      error: detail
        ? `HubSpot ${res.status}: ${baseMsg} · ${detail}`
        : `HubSpot ${res.status}: ${baseMsg}`,
      debug: { url, method: init.method, response: parsed }
    };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

export type PropertyType = "string" | "number" | "datetime" | "enumeration";
export type PropertyFieldType = "text" | "textarea" | "number" | "select" | "date" | "phonenumber";

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

type HubSpotObject = { id: string; properties: Record<string, string> };

export async function searchByProperty(
  objectType: "contacts" | "companies",
  property: string,
  value: string,
  extraProperties: string[] = []
): Promise<HubSpotApiResult<{ total: number; results: HubSpotObject[] }>> {
  const properties = Array.from(new Set([property, "createdate", ...extraProperties]));
  return hubspotFetch(`/crm/v3/objects/${objectType}/search`, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }],
      properties,
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

export async function associateContactCompany(
  contactId: string,
  companyId: string
): Promise<HubSpotApiResult> {
  return hubspotFetch(
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}/associations/companies/${encodeURIComponent(companyId)}/contact_to_company`,
    { method: "PUT" }
  );
}

export async function hubspotRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const r = await hubspotFetch<T>(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

function stripUndefined(obj: HubSpotProperties): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    out[k] = v;
  }
  return out;
}
