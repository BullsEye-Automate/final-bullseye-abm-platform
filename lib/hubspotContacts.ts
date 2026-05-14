// Helpers de lectura de Contacts en HubSpot. Sprint 5 fase 2 — usado por
// el link-orphans flow para resolver calls cuyo hubspot_contact_id no
// matcheó con ningún contacto en Supabase durante el sync.

const HUBSPOT_API_BASE = "https://api.hubapi.com";

const CONTACT_PROPS_FOR_LINKING = [
  "email",
  "firstname",
  "lastname",
  "jobtitle",
  "phone",
  "hs_linkedinid",
  "wecad_contact_id",
  "associatedcompanyid"
];

type HubSpotApiResult<T> =
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

async function hubspotFetch<T>(path: string, init: RequestInit): Promise<HubSpotApiResult<T>> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: false, status: 500, error: "HUBSPOT_ACCESS_TOKEN missing" };
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
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Network error",
      debug: { url }
    };
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 600) };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `HubSpot ${res.status}`, debug: parsed };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

export type HubSpotContactSlim = {
  id: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  jobtitle: string | null;
  phone: string | null;
  hs_linkedinid: string | null;
  wecad_contact_id: string | null;
  associatedcompanyid: string | null;
};

export type HubSpotCompanySlim = {
  id: string;
  name: string | null;
  domain: string | null;
  city: string | null;
  country: string | null;
  numberofemployees: number | null;
  linkedin_company_page: string | null;
};

// Batch read de contactos por sus IDs de HubSpot.
export async function batchReadContacts(
  ids: string[]
): Promise<HubSpotApiResult<HubSpotContactSlim[]>> {
  if (ids.length === 0) return { ok: true, status: 200, data: [] };
  const out: HubSpotContactSlim[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await hubspotFetch<{
      results?: Array<{ id: string; properties?: Record<string, string | null> }>;
    }>("/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: CONTACT_PROPS_FOR_LINKING,
        // idProperty omitido → busca por el id estándar
        inputs: chunk.map((id) => ({ id }))
      })
    });
    if (!res.ok) return res;
    for (const r of res.data.results ?? []) {
      const p = r.properties ?? {};
      out.push({
        id: r.id,
        email: p.email ?? null,
        firstname: p.firstname ?? null,
        lastname: p.lastname ?? null,
        jobtitle: p.jobtitle ?? null,
        phone: p.phone ?? null,
        hs_linkedinid: p.hs_linkedinid ?? null,
        wecad_contact_id: p.wecad_contact_id ?? null,
        associatedcompanyid: p.associatedcompanyid ?? null
      });
    }
  }
  return { ok: true, status: 200, data: out };
}

const COMPANY_PROPS_FOR_LINKING = [
  "name",
  "domain",
  "city",
  "country",
  "numberofemployees",
  "linkedin_company_page"
];

export async function batchReadCompanies(
  ids: string[]
): Promise<HubSpotApiResult<HubSpotCompanySlim[]>> {
  if (ids.length === 0) return { ok: true, status: 200, data: [] };
  const out: HubSpotCompanySlim[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await hubspotFetch<{
      results?: Array<{ id: string; properties?: Record<string, string | null> }>;
    }>("/crm/v3/objects/companies/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: COMPANY_PROPS_FOR_LINKING,
        inputs: chunk.map((id) => ({ id }))
      })
    });
    if (!res.ok) return res;
    for (const r of res.data.results ?? []) {
      const p = r.properties ?? {};
      const employees = p.numberofemployees ? Number(p.numberofemployees) : null;
      out.push({
        id: r.id,
        name: p.name ?? null,
        domain: p.domain ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        numberofemployees: Number.isFinite(employees) ? employees : null,
        linkedin_company_page: p.linkedin_company_page ?? null
      });
    }
  }
  return { ok: true, status: 200, data: out };
}
