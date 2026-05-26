// Cliente HTTP básico para la API de HubSpot.

const HUBSPOT_BASE = "https://api.hubapi.com";

function getToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN no configurado");
  return token;
}

export async function hubspotRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${HUBSPOT_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const msg =
      (data as any)?.message ??
      (data as any)?.error ??
      `HTTP ${res.status}`;
    throw new Error(`HubSpot API error (${res.status}): ${msg}`);
  }

  return data as T;
}

// ── Contactos ────────────────────────────────────────────────────────────────

export async function createHubspotContact(
  properties: Record<string, string>
): Promise<{ id: string }> {
  return hubspotRequest<{ id: string }>("POST", "/crm/v3/objects/contacts", {
    properties,
  });
}

export async function updateHubspotContact(
  contactId: string,
  properties: Record<string, string>
): Promise<{ id: string }> {
  return hubspotRequest<{ id: string }>(
    "PATCH",
    `/crm/v3/objects/contacts/${contactId}`,
    { properties }
  );
}

export async function searchHubspotContactByEmail(
  email: string
): Promise<{ id: string } | null> {
  const data = await hubspotRequest<{
    results: { id: string }[];
  }>("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [
      {
        filters: [{ propertyName: "email", operator: "EQ", value: email }],
      },
    ],
    limit: 1,
  });
  return data.results?.[0] ?? null;
}

// ── Empresas ─────────────────────────────────────────────────────────────────

export async function createHubspotCompany(
  properties: Record<string, string>
): Promise<{ id: string }> {
  return hubspotRequest<{ id: string }>("POST", "/crm/v3/objects/companies", {
    properties,
  });
}

export async function updateHubspotCompany(
  companyId: string,
  properties: Record<string, string>
): Promise<{ id: string }> {
  return hubspotRequest<{ id: string }>(
    "PATCH",
    `/crm/v3/objects/companies/${companyId}`,
    { properties }
  );
}

export async function searchHubspotCompanyByDomain(
  domain: string
): Promise<{ id: string } | null> {
  const data = await hubspotRequest<{
    results: { id: string }[];
  }>("POST", "/crm/v3/objects/companies/search", {
    filterGroups: [
      {
        filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
      },
    ],
    limit: 1,
  });
  return data.results?.[0] ?? null;
}

// ── Asociaciones ─────────────────────────────────────────────────────────────

export async function associateContactToCompany(
  contactId: string,
  companyId: string
): Promise<void> {
  await hubspotRequest(
    "PUT",
    `/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`
  );
}
