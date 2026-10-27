import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { supabaseAdmin } from "@/lib/supabase";
import { detectProperties, loadPropertyCatalog, type DetectedProperty } from "./hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig } from "./store";

// Radar ABM — prueba del HubSpot de un cliente antes de sincronizar.
// Hace una llamada mínima (limit 1) por cada cosa que lee el sync y reporta
// cuáles fallan y qué permiso pide HubSpot, más las propiedades detectadas y
// el tamaño del universo. No guarda nada.

const HS = "https://api.hubapi.com";

export type CheckItem = { key: string; label: string; ok: boolean; required: boolean; detail?: string; scopes?: string[] };

// HubSpot devuelve en el 403 los permisos que faltan (requiredGranularScopes
// o en el texto del mensaje)
function missingScopes(body: string): string[] {
  const found = new Set<string>();
  try {
    const j = JSON.parse(body);
    for (const e of j.errors ?? []) for (const s of e.context?.requiredGranularScopes ?? e.context?.requiredScopes ?? []) found.add(String(s));
    for (const s of j.context?.requiredGranularScopes ?? j.context?.requiredScopes ?? []) found.add(String(s));
  } catch {
    // texto plano: se buscan nombres de permiso en el mensaje
  }
  if (!found.size) for (const m of body.match(/\b(?:crm|sales|e-commerce|tickets)[a-z0-9.\-]*\.(?:read|write)\b/g) ?? []) found.add(m);
  return Array.from(found);
}

async function probe(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: any; text: string }> {
  const res = await hsFetchWithRetry(url, init);
  const text = await res.text().catch(() => "");
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* sin JSON */ }
  return { ok: res.ok, status: res.status, body, text };
}

const describe = (r: { status: number; body: any; text: string }) => {
  if (r.status === 401) return "HubSpot rechazó el token (401): revisa que esté bien copiado o vuelve a conectarlo.";
  if (r.status === 403) return "Sin permiso (403).";
  return `HubSpot ${r.status}: ${(r.body?.message ?? r.text).slice(0, 200)}`;
};

export async function checkClientHubspot(clientId: string) {
  const [settings, cfg, { data: client }] = await Promise.all([
    loadClientSettings(clientId),
    loadRadarConfig(),
    supabaseAdmin().from("clients").select("name").eq("id", clientId).maybeSingle(),
  ]);
  const token = await hubspotTokenFor(clientId, settings.hubspot_source);
  const headers = hsHeaders(token);
  const items: CheckItem[] = [];

  const search = (obj: string, filters: unknown[] = []) =>
    probe(`${HS}/crm/v3/objects/${obj}/search`, { method: "POST", headers, body: JSON.stringify({ filterGroups: filters.length ? [{ filters }] : [], limit: 1, properties: ["hs_object_id"] }) });
  const add = (key: string, label: string, required: boolean, r: { ok: boolean; status: number; body: any; text: string }, okDetail?: string) =>
    items.push(r.ok ? { key, label, ok: true, required, detail: okDetail } : { key, label, ok: false, required, detail: describe(r), scopes: r.status === 403 ? missingScopes(r.text) : undefined });

  // Propiedades (esquemas) — sin esto no se detecta el mapeo
  const { catalog, errors } = await loadPropertyCatalog(token);
  const schemaOk = ["companies", "contacts", "meetings"].every((o) => catalog[o]?.length);
  items.push(schemaOk
    ? { key: "schemas", label: "Propiedades de empresas, contactos y reuniones", ok: true, required: true }
    : { key: "schemas", label: "Propiedades de empresas, contactos y reuniones", ok: false, required: true, detail: errors[0]?.slice(0, 240), scopes: missingScopes(errors.join(" ")) });

  const detected = detectProperties(effectiveProperties(cfg, settings), catalog, client?.name);
  const P = Object.fromEntries(detected.map((d) => [d.key, d])) as Record<string, DetectedProperty>;

  // Universo: empresas con status (con "Cliente BullsEye" si se configuró un valor)
  const statusProp = P.companyStatus.property;
  const clientValue = (settings.hubspot_client_value ?? "").trim();
  let universe: number | null = null;
  if (statusProp) {
    const filters: unknown[] = [{ propertyName: statusProp, operator: "HAS_PROPERTY" }];
    if (P.companyClient.property && clientValue) {
      filters.push({ propertyName: P.companyClient.property, operator: P.companyClient.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: clientValue });
    }
    const r = await search("companies", filters);
    if (r.ok) universe = Number(r.body?.total ?? 0);
    add("companies", "Empresas", true, r, r.ok ? `${universe} empresas con "Status de la asignación - SDR"` : undefined);
  } else {
    add("companies", "Empresas", true, await search("companies"));
  }

  let contacts: number | null = null;
  if (P.contactStatus.property) {
    const r = await search("contacts", [{ propertyName: P.contactStatus.property, operator: "HAS_PROPERTY" }]);
    if (r.ok) contacts = Number(r.body?.total ?? 0);
    add("contacts", "Contactos", true, r, r.ok ? `${contacts} contactos con "Asignación BullsEye por Llamar"` : undefined);
  } else {
    add("contacts", "Contactos", true, await search("contacts"));
  }

  add("owners", "Usuarios (SDR)", false, await probe(`${HS}/crm/v3/owners?limit=1`, { headers }));
  add("calls", "Llamadas (intentos)", false, await search("calls"));
  add("meetings", "Reuniones", false, await search("meetings"));
  add("emails", "Correos", false, await search("emails"));
  add("communications", "WhatsApp / LinkedIn", false, await search("communications"));
  add("notes", "Notas", false, await search("notes"));
  add("deals", "Negocios (pipeline)", false, await search("deals"));

  return {
    source: settings.hubspot_source,
    items,
    universe,
    contacts,
    properties: detected,
    ready: items.filter((i) => i.required).every((i) => i.ok) && !!statusProp && !!P.contactStatus.property,
  };
}
