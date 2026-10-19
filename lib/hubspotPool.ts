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

// Propiedades que siempre se incluyen aunque no estén en companyinformation
const ALWAYS_INCLUDE = new Set(["web_technologies", "name", "domain"]);

// Nunca se exponen (datos de la relación comercial o internos de HubSpot)
const DENY_PREFIXES = [
  "hs_", "bullseye_", "hubspot_", "notes_", "num_", "recent_", "first_",
  "engagements_", "days_to_close", "closedate", "createdate", "lifecyclestage",
  "associated", "total_revenue", "total_money", "hubspot_team", "owner",
];
// Nombres exactos que tampoco se exponen: "type" es el tipo de relación
// con BullsEye (Prospect, Partner, Vendor…), no un dato de la empresa.
const DENY_NAMES = new Set(["type", "is_public"]);
// Excepciones útiles dentro de hs_* (datos de la empresa, no de la relación)
const HS_ALLOW = new Set(["hs_linkedin_handle", "hs_country_code", "hs_industry_group"]);

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
  if (ALWAYS_INCLUDE.has(p.name) || HS_ALLOW.has(p.name)) return true;
  if (p.hidden) return false;
  if (p.groupName !== "companyinformation") return false;
  if (p.type === "datetime" || DENY_NAMES.has(p.name)) return false;
  return !DENY_PREFIXES.some((prefix) => p.name.startsWith(prefix));
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
  if (def.type === "number") {
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
// rellenadas quedan con filled_count = 0 y el portal no las muestra.
async function refreshPropertyStats(db: SupabaseClient, defs: HSPropertyDef[]) {
  const rows = [];
  for (const def of defs) {
    if (def.name === "name") continue;
    const { count } = await db
      .from("hubspot_company_pool")
      .select("hs_id", { count: "exact", head: true })
      .not(`properties->${def.name}`, "is", null);
    rows.push({
      name: def.name,
      label: def.label,
      type: def.type,
      field_type: def.fieldType ?? null,
      options: (def.options ?? []).filter((o) => !o.hidden).map((o) => ({ value: o.value, label: o.label })),
      filled_count: count ?? 0,
      updated_at: new Date().toISOString(),
    });
  }
  await db.from("hubspot_pool_properties").delete().not("name", "in", `(${rows.map((r) => `"${r.name}"`).join(",") || '""'})`);
  if (rows.length) await db.from("hubspot_pool_properties").upsert(rows, { onConflict: "name" });
}

export async function listPoolProperties(db: SupabaseClient): Promise<PoolProperty[]> {
  const { data } = await db
    .from("hubspot_pool_properties")
    .select("name, label, type, field_type, options, filled_count")
    .gt("filled_count", 0)
    .order("filled_count", { ascending: false });
  return (data ?? []) as PoolProperty[];
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
    companies: rows.map(({ total_count: _t, ...c }) => c),
    total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
  };
}
