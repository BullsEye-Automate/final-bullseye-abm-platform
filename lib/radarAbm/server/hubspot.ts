import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { PROPERTY_DEFS } from "../dictionaries";

// Radar ABM — lectura de HubSpot (solo lectura, API CRM v3/v4). El token es
// el de BullsEye (HUBSPOT_ACCESS_TOKEN) o el token propio del cliente
// (client_configs.hubspot_access_token); nunca llega al navegador.

const HS = "https://api.hubapi.com";

export type HSProperty = {
  name: string;
  label: string;
  type: string;
  fieldType?: string;
  options?: { label: string; value: string; hidden?: boolean }[];
};

async function hsJson(url: string, init: RequestInit, what: string): Promise<any> {
  const res = await hsFetchWithRetry(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status} ${what}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function listProperties(objectType: string, token?: string): Promise<HSProperty[]> {
  const d = await hsJson(`${HS}/crm/v3/properties/${objectType}`, { headers: hsHeaders(token) }, `leyendo propiedades de ${objectType}`);
  return (d.results ?? []) as HSProperty[];
}

export const normLabel = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type PropertyCatalog = Record<string, HSProperty[]>;

// Propiedades de empresas, contactos y reuniones (una llamada por objeto)
export async function loadPropertyCatalog(token?: string): Promise<{ catalog: PropertyCatalog; errors: string[] }> {
  const catalog: PropertyCatalog = {};
  const errors: string[] = [];
  for (const obj of ["companies", "contacts", "meetings"]) {
    try {
      catalog[obj] = await listProperties(obj, token);
    } catch (e) {
      catalog[obj] = [];
      errors.push((e as Error).message);
    }
  }
  return { catalog, errors };
}

// Busca el nombre interno de cada propiedad del Radar por su etiqueta
// (§3.1: se confirman en el portal). Primero calce exacto de etiqueta,
// después etiqueta que empieza igual. Lo configurado a mano manda.
export function detectProperties(configured: Record<string, string>, catalog: PropertyCatalog) {
  return PROPERTY_DEFS.map((def) => {
    const props = catalog[def.object] ?? [];
    const manual = (configured[def.key] ?? "").trim();
    let prop: HSProperty | undefined;
    if (manual) prop = props.find((p) => p.name === manual);
    if (!prop && !manual) {
      const target = normLabel(def.label);
      prop = props.find((p) => normLabel(p.label) === target) ?? props.find((p) => normLabel(p.label).startsWith(target));
    }
    return {
      key: def.key,
      object: def.object,
      label: def.label,
      required: !!def.required,
      property: prop?.name ?? (manual || null),
      found: !!prop,
      manual: !!manual,
      propLabel: prop?.label ?? null,
      type: prop?.type ?? null,
      fieldType: prop?.fieldType ?? null,
      options: (prop?.options ?? []).filter((o) => !o.hidden).map((o) => ({ label: o.label, value: o.value })),
    };
  });
}
export type DetectedProperty = ReturnType<typeof detectProperties>[number];

// Búsqueda paginada (100 por página, tope de HubSpot: 10.000 resultados)
export async function searchAll(
  objectType: string,
  filterGroups: unknown[],
  properties: string[],
  token?: string,
  max = 10_000
): Promise<{ id: string; properties: Record<string, string | null> }[]> {
  const out: { id: string; properties: Record<string, string | null> }[] = [];
  let after: string | undefined;
  do {
    const body: Record<string, unknown> = { filterGroups, properties, limit: 100, sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }] };
    if (after) body.after = after;
    const d = await hsJson(`${HS}/crm/v3/objects/${objectType}/search`, { method: "POST", headers: hsHeaders(token), body: JSON.stringify(body) }, `buscando ${objectType}`);
    for (const r of d.results ?? []) out.push({ id: String(r.id), properties: r.properties ?? {} });
    after = d.paging?.next?.after;
  } while (after && out.length < max);
  return out;
}

// Asociaciones en lote (v4): id de origen → ids asociados
export async function batchAssociations(fromType: string, toType: string, ids: string[], token?: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const inputs = ids.slice(i, i + 100).map((id) => ({ id }));
    const res = await hsFetchWithRetry(`${HS}/crm/v4/associations/${fromType}/${toType}/batch/read`, {
      method: "POST",
      headers: hsHeaders(token),
      body: JSON.stringify({ inputs }),
    });
    // 207 = algunos ids sin asociaciones (vienen en "errors"): no es error
    if (!res.ok && res.status !== 207) {
      const text = await res.text().catch(() => "");
      throw new Error(`HubSpot ${res.status} leyendo asociaciones ${fromType}→${toType}: ${text.slice(0, 300)}`);
    }
    const d = await res.json();
    for (const r of d.results ?? []) {
      const from = String(r.from?.id ?? "");
      if (!from) continue;
      const arr = out.get(from) ?? [];
      for (const t of r.to ?? []) if (t.toObjectId != null) arr.push(String(t.toObjectId));
      out.set(from, arr);
    }
  }
  return out;
}

// Lectura en lote de cualquier objeto (de a 100)
export async function batchRead(objectType: string, ids: string[], properties: string[], token?: string) {
  const out: { id: string; properties: Record<string, string | null> }[] = [];
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 100) {
    const d = await hsJson(
      `${HS}/crm/v3/objects/${objectType}/batch/read`,
      { method: "POST", headers: hsHeaders(token), body: JSON.stringify({ properties, inputs: unique.slice(i, i + 100).map((id) => ({ id })) }) },
      `leyendo ${objectType}`
    );
    for (const r of d.results ?? []) out.push({ id: String(r.id), properties: r.properties ?? {} });
  }
  return out;
}

// Etapas de negocio: id → { label, ganado/perdido }
export async function dealStages(token?: string): Promise<Map<string, { label: string; won: boolean; lost: boolean }>> {
  const out = new Map<string, { label: string; won: boolean; lost: boolean }>();
  const d = await hsJson(`${HS}/crm/v3/pipelines/deals`, { headers: hsHeaders(token) }, "leyendo pipelines de negocios");
  for (const p of d.results ?? []) {
    for (const s of p.stages ?? []) {
      const closed = String(s.metadata?.isClosed ?? "") === "true";
      const prob = Number(s.metadata?.probability ?? NaN);
      out.set(String(s.id), { label: String(s.label ?? s.id), won: closed && prob >= 1, lost: closed && !(prob >= 1) });
    }
  }
  return out;
}
