const HS = "https://api.hubapi.com";

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

// Opciones conocidas de cliente_bullseye_empresa (actualizar si se agregan nuevas)
const CLIENT_OPTIONS = [
  "BullsEye", "SOVOS", "Crossnet", "Apply Digital", "AcidLab",
  "CanalCero", "Lemu", "Otro", "Webfleet", "Ecommerce",
];

export function matchClientOption(clientName: string): string | null {
  const n = norm(clientName);
  return (
    CLIENT_OPTIONS.find((o) => norm(o) === n) ??
    CLIENT_OPTIONS.find((o) => { const no = norm(o); return n.includes(no) || no.includes(n); }) ??
    null
  );
}

export async function searchHSCompany(name: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function upsertHSCompany(
  props: Record<string, string | number | null | undefined>,
  existingId?: string | null
): Promise<string | null> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  if (existingId) {
    const res = await fetch(`${HS}/crm/v3/objects/companies/${existingId}`, {
      method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
    });
    return res.ok ? existingId : null;
  }
  const res = await fetch(`${HS}/crm/v3/objects/companies`, {
    method: "POST", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  if (!res.ok) return null;
  return (await res.json()).id ?? null;
}

export async function searchHSContact(email: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function upsertHSContact(
  props: Record<string, string | number | null | undefined>,
  existingId?: string | null
): Promise<string | null> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  if (existingId) {
    const res = await fetch(`${HS}/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
    });
    return res.ok ? existingId : null;
  }
  const res = await fetch(`${HS}/crm/v3/objects/contacts`, {
    method: "POST", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  if (!res.ok) return null;
  return (await res.json()).id ?? null;
}

export async function associateContactCompany(contactId: string, companyId: string): Promise<void> {
  await fetch(
    `${HS}/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
    { method: "PUT", headers: hsHeaders() }
  );
}

export async function patchHSContact(contactId: string, props: Record<string, string | number | null>): Promise<boolean> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  const res = await fetch(`${HS}/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  return res.ok;
}
