import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { detectProperties, loadPropertyCatalog, type DetectedProperty } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig } from "@/lib/radarAbm/server/store";

// Respuestas Lemlist → SDR: HubSpot con la MISMA lógica de Pulso ABM.
// Token: el de BullsEye o el propio del cliente (hubspotTokenFor). Propiedades
// por cliente detectadas igual que en Configuración → Cliente → Pulso ABM:
// "SDR - <cliente>" (empresa), "SDR Asignado - <cliente>" (contacto) y
// "Asignación BullsEye por llamar - <cliente>" (estado del contacto).

const HS = "https://api.hubapi.com";
export const HOT_CALLING = "Hot Calling";

export type ClientHubspot = {
  source: "bullseye" | "client";
  token: string | undefined;
  companySdr: string | null;
  contactSdr: string | null;
  contactStatus: string | null;
  hotCallingValue: string | null;   // valor de la opción "Hot Calling" en contactStatus (si existe)
  portalUrl: string | null;          // https://<uiDomain>/contacts/<portalId> para armar links
  warnings: string[];
};

export async function loadClientHubspot(client: { id: string; name: string }): Promise<ClientHubspot> {
  const cfg = await loadRadarConfig();
  const settings = await loadClientSettings(client.id);
  const token = await hubspotTokenFor(client.id, settings.hubspot_source);
  const { catalog, errors } = await loadPropertyCatalog(token);
  const detected = detectProperties(effectiveProperties(cfg, settings), catalog, client.name);
  const P = Object.fromEntries(detected.map((d) => [d.key, d])) as Record<string, DetectedProperty>;
  const prop = (k: string) => (P[k]?.found ? P[k].property : null);
  const status = P.contactStatus;
  const hot = status?.found
    ? status.options.find((o) => o.value.toLowerCase().replace(/\s+/g, " ").trim() === "hot calling" || o.label.toLowerCase().startsWith("hot calling"))
    : undefined;
  const warnings = [...errors];
  if (!prop("companySdr") && !prop("contactSdr")) warnings.push("No tiene propiedad SDR en HubSpot: sus respuestas van al KAM.");
  if (status?.found && !hot) warnings.push(`La propiedad "${status.propLabel}" no tiene la opción "Hot Calling".`);
  const acct = await hsJson(`${HS}/account-info/v3/details`, { headers: hsHeaders(token) }).catch(() => null);
  const portalUrl = acct?.portalId ? `https://${acct.uiDomain || "app.hubspot.com"}/contacts/${acct.portalId}` : null;
  return {
    portalUrl,
    source: settings.hubspot_source,
    token,
    companySdr: prop("companySdr"),
    contactSdr: prop("contactSdr"),
    contactStatus: prop("contactStatus"),
    hotCallingValue: hot?.value ?? null,
    warnings,
  };
}

async function hsJson(url: string, init: RequestInit): Promise<any> {
  const res = await hsFetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json();
}

export type LeadInHubspot = {
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  sdrValue: string | null;     // SDR de la empresa; si no, el del contacto
  sdrFrom: "empresa" | "contacto" | null;
};

// Contacto por email → empresa asociada → SDR de la empresa (o del contacto)
export async function findLead(hs: ClientHubspot, email: string): Promise<LeadInHubspot> {
  const headers = hsHeaders(hs.token);
  const contactProps = ["email", "firstname", "lastname", ...(hs.contactSdr ? [hs.contactSdr] : [])];
  const found = await hsJson(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }], properties: contactProps, limit: 1 }),
  });
  const contact = found.results?.[0];
  if (!contact) return { contactId: null, companyId: null, companyName: null, sdrValue: null, sdrFrom: null };
  const contactId = String(contact.id);
  const contactSdr = hs.contactSdr ? (contact.properties?.[hs.contactSdr] ?? null) : null;

  const assoc = await hsJson(`${HS}/crm/v4/objects/contacts/${contactId}/associations/companies?limit=10`, { headers }).catch(() => ({ results: [] }));
  const companyIds: string[] = (assoc.results ?? []).map((r: { toObjectId: string | number }) => String(r.toObjectId));
  let companyId: string | null = companyIds[0] ?? null;
  let companyName: string | null = null;
  let companySdr: string | null = null;
  for (const id of companyIds.slice(0, 5)) {
    const props = ["name", ...(hs.companySdr ? [hs.companySdr] : [])].join(",");
    const co = await hsJson(`${HS}/crm/v3/objects/companies/${id}?properties=${encodeURIComponent(props)}`, { headers }).catch(() => null);
    if (!co) continue;
    const sdr = hs.companySdr ? (co.properties?.[hs.companySdr] ?? null) : null;
    if (!companyName || sdr) { companyId = id; companyName = co.properties?.name ?? null; }
    if (sdr) { companySdr = sdr; break; }
  }
  if (companySdr) return { contactId, companyId, companyName, sdrValue: companySdr, sdrFrom: "empresa" };
  if (contactSdr) return { contactId, companyId, companyName, sdrValue: contactSdr, sdrFrom: "contacto" };
  return { contactId, companyId, companyName, sdrValue: null, sdrFrom: null };
}

// Marca el contacto como "Hot Calling" (solo modo activo)
export async function markHotCalling(hs: ClientHubspot, contactId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hs.contactStatus || !hs.hotCallingValue) return { ok: false, error: "Sin propiedad de estado del contacto o sin la opción Hot Calling." };
  const res = await hsFetchWithRetry(`${HS}/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH",
    headers: hsHeaders(hs.token),
    body: JSON.stringify({ properties: { [hs.contactStatus]: hs.hotCallingValue } }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  const hint = res.status === 403 && hs.source === "client" ? " (el token del HubSpot del cliente es de solo lectura: falta crm.objects.contacts.write)" : "";
  return { ok: false, error: `HubSpot ${res.status}${hint}: ${text.slice(0, 150)}` };
}

export function hubspotContactUrl(hs: ClientHubspot, contactId: string | null): string | null {
  if (!contactId || !hs.portalUrl) return null;
  return `${hs.portalUrl}/record/0-1/${contactId}`;
}
