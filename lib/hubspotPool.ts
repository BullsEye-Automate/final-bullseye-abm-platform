import type { SupabaseClient } from "@supabase/supabase-js";

// Pool de empresas de HubSpot (base de BullsEye) para la wishlist del portal.
//
// Se copia a Supabase (hubspot_company_pool) para filtrar y puntuar sin pegarle
// a HubSpot en cada búsqueda. Regla acordada: se filtra por TODAS las
// propiedades que estén rellenadas — pero solo propiedades de datos de la
// empresa (grupo "companyinformation" + "Tecnologías"). Nunca se copian datos
// de prospección (owner, lifecycle, deals, notas, propiedades bullseye_*),
// porque el pool lo ven todos los clientes.

const HS = "https://api.hubapi.com";

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// LISTA CERRADA de propiedades que se copian al pool. No se usa "todo el
// grupo companyinformation" porque en HubSpot hay propiedades custom de
// prospección creadas en ese grupo (Wish List - <cliente>, SDR - <cliente>,
// Status de la asignación, Razones del Lost…) y el pool lo ven TODOS los
// clientes. Solo propiedades estándar de HubSpot con datos de la empresa.
// Para sumar una propiedad nueva: agregarla acá y volver a sincronizar.
//   filter = aparece como filtro en el portal (y en la tarjeta)
//   card   = solo se muestra en la tarjeta de la empresa
export const POOL_PROPERTIES: Record<string, "filter" | "card"> = {
  industry: "filter",
  hs_industry_group: "filter",
  numberofemployees: "filter",
  annualrevenue: "filter",
  web_technologies: "filter",
  country: "filter",
  state: "filter",
  city: "filter",
  founded_year: "filter",
  description: "card",
  website: "card",
  linkedin_company_page: "card",
  hs_linkedin_handle: "card",
};
// name y domain se leen siempre (identifican la empresa)
const BASE_PROPERTIES = ["name", "domain"];
// Propiedades que HubSpot define como texto pero se filtran como número
const NUMERIC_OVERRIDE = new Set(["founded_year"]);
// Cuántos valores distintos se ofrecen como opciones en filtros de texto
const MAX_TEXT_OPTIONS = 300;

type HSPropertyDef = {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  hidden?: boolean;
  calculated?: boolean;
  options?: { value: string; label: string; hidden?: boolean }[];
};

export type PoolProperty = {
  name: string;
  label: string;
  type: string;
  field_type: string | null;
  options: { value: string; label: string }[];
  filled_count: number;
};

function isAllowedProperty(p: HSPropertyDef): boolean {
  return BASE_PROPERTIES.includes(p.name) || p.name in POOL_PROPERTIES;
}

export async function fetchPoolPropertyDefs(): Promise<HSPropertyDef[]> {
  const res = await fetch(`${HS}/crm/v3/properties/companies`, { headers: hsHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status} leyendo propiedades: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return ((data.results ?? []) as HSPropertyDef[]).filter(isAllowedProperty);
}

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
  return d && d.includes(".") ? d : null;
}

// Convierte los valores de HubSpot (siempre string) al tipo útil para filtrar
function coerceValue(def: HSPropertyDef, raw: string): unknown {
  if (def.type === "number" || NUMERIC_OVERRIDE.has(def.name)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  // checkbox / multi-select de HubSpot: valores separados por ";"
  if (def.type === "enumeration" && (def.fieldType === "checkbox" || raw.includes(";"))) {
    return raw.split(";").map((v) => v.trim()).filter(Boolean);
  }
  if (def.type === "bool") return raw === "true";
  return raw;
}

const SYNC_ID = "hubspot";
const PAGES_PER_CHUNK = 20; // 2.000 empresas por llamada, ~10–20 s

export type SyncState = {
  status: "idle" | "running" | "done" | "error";
  synced_count: number;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
};

export async function getSyncState(db: SupabaseClient): Promise<SyncState & { total_in_pool: number }> {
  const [{ data }, { count }] = await Promise.all([
    db.from("hubspot_pool_sync_state").select("*").eq("id", SYNC_ID).maybeSingle(),
    db.from("hubspot_company_pool").select("hs_id", { count: "exact", head: true }),
  ]);
  return {
    status: data?.status ?? "idle",
    synced_count: data?.synced_count ?? 0,
    started_at: data?.started_at ?? null,
    finished_at: data?.finished_at ?? null,
    last_error: data?.last_error ?? null,
    total_in_pool: count ?? 0,
  };
}

// Procesa un tramo de la sincronización. `restart` empieza de cero.
// Devuelve done = true cuando terminó la pasada completa. Se llama en loop
// desde /solicitudes-clientes (cada llamada cabe en el límite de Vercel).
export async function syncPoolChunk(
  db: SupabaseClient,
  restart: boolean
): Promise<{ done: boolean; synced_count: number }> {
  const { data: state } = await db.from("hubspot_pool_sync_state").select("*").eq("id", SYNC_ID).maybeSingle();
  const now = new Date().toISOString();
  let after: string | null = state?.after_cursor ?? null;
  let syncedCount: number = state?.synced_count ?? 0;
  let startedAt: string = state?.started_at ?? now;

  if (restart || !state || state.status !== "running") {
    after = null;
    syncedCount = 0;
    startedAt = now;
  }

  try {
    const defs = await fetchPoolPropertyDefs();
    const defByName = new Map(defs.map((d) => [d.name, d]));
    const propNames = defs.map((d) => d.name);

    let pages = 0;
    let retries = 0;
    let finished = false;
    while (pages < PAGES_PER_CHUNK) {
      const url = new URL(`${HS}/crm/v3/objects/companies`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("properties", propNames.join(","));
      url.searchParams.set("archived", "false");
      if (after) url.searchParams.set("after", after);

      const res = await fetch(url.toString(), { headers: hsHeaders() });
      if (res.status === 429 && retries < 5) {
        retries++;
        await new Promise((r) => setTimeout(r, 1500 * retries));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HubSpot ${res.status} listando empresas: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const rows = ((data.results ?? []) as { id: string; properties: Record<string, string | null> }[])
        .map((r) => {
          const props: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r.properties ?? {})) {
            const def = defByName.get(k);
            if (!def || v == null || String(v).trim() === "") continue;
            props[k] = coerceValue(def, String(v).trim());
          }
          const name = (r.properties?.name ?? "").trim();
          return name
            ? { hs_id: r.id, name, domain: normalizeDomain(r.properties?.domain), properties: props, synced_at: now }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length) {
        const { error } = await db.from("hubspot_company_pool").upsert(rows, { onConflict: "hs_id" });
        if (error) throw new Error(error.message);
        syncedCount += rows.length;
      }

      after = data.paging?.next?.after ?? null;
      pages++;
      if (!after) {
        finished = true;
        break;
      }
    }

    if (finished) {
      // Empresas borradas/archivadas en HubSpot: las que no se tocaron en esta pasada
      await db.from("hubspot_company_pool").delete().lt("synced_at", startedAt);
      await refreshPropertyStats(db, defs);
    }

    await db.from("hubspot_pool_sync_state").upsert({
      id: SYNC_ID,
      status: finished ? "done" : "running",
      after_cursor: finished ? null : after,
      synced_count: syncedCount,
      started_at: startedAt,
      finished_at: finished ? new Date().toISOString() : null,
      last_error: null,
      updated_at: new Date().toISOString(),
    });

    return { done: finished, synced_count: syncedCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("hubspot_pool_sync_state").upsert({
      id: SYNC_ID,
      status: "error",
      after_cursor: after,
      synced_count: syncedCount,
      started_at: startedAt,
      last_error: message,
      updated_at: new Date().toISOString(),
    });
    throw err;
  }
}

// Guarda definición + cobertura de cada propiedad. Las que nadie tiene
// rellenadas quedan con filled_count = 0 y el portal no las muestra. Para
// filtros de texto sin opciones en HubSpot (país, ciudad…) se ofrecen como
// opciones los valores más frecuentes del pool.
async function refreshPropertyStats(db: SupabaseClient, defs: HSPropertyDef[]) {
  const tracked = defs.filter((d) => d.name in POOL_PROPERTIES);
  const filled = new Map<string, number>();
  const valueCounts = new Map<string, Map<string, { label: string; n: number }>>();
  for (const d of tracked) valueCounts.set(d.name, new Map());

  // Una sola pasada por el pool (ya solo trae propiedades permitidas)
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await db.from("hubspot_company_pool").select("properties").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const props = (row.properties ?? {}) as Record<string, unknown>;
      for (const d of tracked) {
        const v = props[d.name];
        if (v == null || v === "") continue;
        filled.set(d.name, (filled.get(d.name) ?? 0) + 1);
        for (const item of Array.isArray(v) ? v : [v]) {
          if (typeof item !== "string") continue;
          const key = item.trim().toLowerCase();
          if (!key) continue;
          const m = valueCounts.get(d.name)!;
          const cur = m.get(key);
          m.set(key, { label: cur?.label ?? item.trim(), n: (cur?.n ?? 0) + 1 });
        }
      }
    }
    if (!data || data.length < 1000) break;
  }

  const rows = tracked.map((def) => {
    const isNumber = def.type === "number" || NUMERIC_OVERRIDE.has(def.name);
    let options = (def.options ?? []).filter((o) => !o.hidden).map((o) => ({ value: o.value, label: o.label }));
    if (!isNumber && options.length === 0) {
      options = Array.from(valueCounts.get(def.name)!.values())
        .sort((a, b) => b.n - a.n)
        .slice(0, MAX_TEXT_OPTIONS)
        .map((v) => ({ value: v.label, label: v.label }));
    }
    return {
      name: def.name,
      label: def.label,
      type: isNumber ? "number" : def.type,
      field_type: def.fieldType ?? null,
      options,
      filled_count: filled.get(def.name) ?? 0,
      updated_at: new Date().toISOString(),
    };
  });

  // Borra definiciones de propiedades que ya no están en la lista permitida
  const keep = rows.map((r) => `"${r.name}"`).join(",") || '""';
  await db.from("hubspot_pool_properties").delete().not("name", "in", `(${keep})`);
  if (rows.length) await db.from("hubspot_pool_properties").upsert(rows, { onConflict: "name" });
}

// Deja solo las propiedades de la lista permitida (por si el pool tiene datos
// de una sincronización anterior a la lista cerrada)
export function pickAllowed(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) if (k in POOL_PROPERTIES) out[k] = v;
  return out;
}

export function isFilterableProperty(name: string): boolean {
  return POOL_PROPERTIES[name] === "filter";
}

export async function listPoolProperties(db: SupabaseClient): Promise<PoolProperty[]> {
  const { data } = await db
    .from("hubspot_pool_properties")
    .select("name, label, type, field_type, options, filled_count")
    .gt("filled_count", 0)
    .order("filled_count", { ascending: false });
  // Filtro en código además de en la tabla: aunque quede una definición vieja
  // en la base, solo salen las propiedades de la lista permitida
  return ((data ?? []) as PoolProperty[]).filter((p) => p.name in POOL_PROPERTIES);
}

export type PoolFilter =
  | { property: string; op: "in"; values: string[] }
  | { property: string; op: "range"; min?: number | null; max?: number | null }
  | { property: string; op: "contains"; value: string }
  | { property: string; op: "exists" };

export type PoolCompany = { hs_id: string; name: string; domain: string | null; properties: Record<string, unknown> };

export async function searchPool(
  db: SupabaseClient,
  opts: {
    filters: PoolFilter[];
    query?: string | null;
    excludeDomains: string[];
    excludeNames: string[];
    limit: number;
    offset: number;
  }
): Promise<{ companies: PoolCompany[]; total: number }> {
  const { data, error } = await db.rpc("search_hubspot_pool", {
    p_filters: opts.filters,
    p_query: opts.query?.trim() || null,
    p_exclude_domains: opts.excludeDomains,
    p_exclude_names: opts.excludeNames,
    p_limit: opts.limit,
    p_offset: opts.offset,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (PoolCompany & { total_count: number })[];
  return {
    companies: rows.map(({ total_count: _t, ...c }) => ({ ...c, properties: pickAllowed(c.properties) })),
    total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
  };
}
