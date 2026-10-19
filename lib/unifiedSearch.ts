import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, HAIKU_MODEL } from "./claude";
import { logAiUsage } from "./aiUsageLogger";
import { listPoolProperties, searchPool, type PoolFilter, type PoolProperty } from "./hubspotPool";
import { getLemlistCompanyFilters, searchLemlistCompanies, type LemlistFilter, type LemlistFilterDef } from "./lemlistDatabase";
import { isExcluded, lemlistCompanyToCard, poolCompanyToCard, type ClientExclusions, type CompanyCard } from "./wishlist";
import {
  ALL_FILTERS,
  COUNTRIES,
  HEADCOUNT_FALLBACK,
  REVENUE_FALLBACK,
  filterValues,
  headcountLabel,
  parseHeadcountBucket,
  parseRevenueBucket,
  unionRange,
  type UnifiedFilterKey,
  type UnifiedFilters,
} from "./unifiedFilterDefs";

// Búsqueda unificada de la wishlist: un solo set de filtros (en español) que
// se aplica primero a la base HubSpot de BullsEye y, cuando se agota, a la
// base de Lemlist del cliente (volumen casi infinito). El cliente no ve de qué
// base viene cada empresa.

export type FilterOption = { value: string; label: string };
export type FilterCatalog = {
  lemlist: boolean;                          // el cliente tiene key de Lemlist operativa
  industryTaxonomy: "lemlist" | "hubspot";   // de dónde salen los valores de industria
  available: UnifiedFilterKey[];             // filtros que se muestran
  options: Partial<Record<UnifiedFilterKey, FilterOption[]>>;
};

export type SearchCursor = { phase: "hubspot" | "lemlist" | "done"; hsOffset: number; lemPage: number };
export const FIRST_CURSOR: SearchCursor = { phase: "hubspot", hsOffset: 0, lemPage: 1 };

// ── Traducciones al español (IA, cacheadas en lemlist_value_labels) ──────

const TRANSLATE_TOOL: Anthropic.Tool = {
  name: "translations",
  description: "Traducciones al español",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: "object", properties: { value: { type: "string" }, label_es: { type: "string" } }, required: ["value", "label_es"] },
      },
    },
    required: ["items"],
  },
};

async function translateValues(db: SupabaseClient, filterId: string, values: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!values.length) return out;
  const { data } = await db.from("lemlist_value_labels").select("value, label_es").eq("filter_id", filterId);
  for (const r of data ?? []) out.set(r.value, r.label_es);
  const missing = values.filter((v) => !out.has(v));
  if (!missing.length) return out;

  try {
    const message = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 8000,
      temperature: 0,
      system: "Traduces al español neutro de Latinoamérica etiquetas de filtros de una base B2B (industrias, regiones, tipos de empresa, plazos). Traducciones cortas y naturales, como las usaría un equipo comercial. Mantén siglas (B2B, B2C, SaaS) y nombres propios. Devuelve una traducción por cada valor, con el value exacto.",
      tools: [TRANSLATE_TOOL],
      tool_choice: { type: "tool", name: TRANSLATE_TOOL.name },
      messages: [{ role: "user", content: `Filtro: ${filterId}\nValores:\n${missing.map((v) => `- ${v}`).join("\n")}` }],
    });
    void logAiUsage({ functionName: "portal_translate_filters", model: HAIKU_MODEL, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
    const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const items = ((block?.input as { items?: { value: string; label_es: string }[] })?.items ?? []).filter(
      (i) => missing.includes(i.value) && i.label_es?.trim()
    );
    if (items.length) {
      await db.from("lemlist_value_labels").upsert(
        items.map((i) => ({ filter_id: filterId, value: i.value, label_es: i.label_es.trim().slice(0, 200) })),
        { onConflict: "filter_id,value" }
      );
      for (const i of items) out.set(i.value, i.label_es.trim());
    }
  } catch (err) {
    // Sin traducción se muestra el valor original: nunca bloquea la búsqueda
    console.error("translateValues:", err);
  }
  return out;
}

// ── Catálogo de filtros para el portal ───────────────────────────────────

export async function buildFilterCatalog(db: SupabaseClient, lemlistKey: string | null): Promise<FilterCatalog> {
  let defs: LemlistFilterDef[] | null = null;
  if (lemlistKey) {
    const r = await getLemlistCompanyFilters(lemlistKey);
    if (r.ok) defs = r.data;
  }
  const props = await listPoolProperties(db);
  const byId = new Map((defs ?? []).map((d) => [d.filterId, d]));
  const options: FilterCatalog["options"] = {};

  const lemlistSelect = async (key: UnifiedFilterKey, filterId: string, translate: boolean) => {
    const values = byId.get(filterId)?.values ?? [];
    if (!values.length) return;
    const labels = translate ? await translateValues(db, filterId, values) : new Map<string, string>();
    options[key] = values.map((v) => ({ value: v, label: labels.get(v) ?? v }));
  };

  let industryTaxonomy: FilterCatalog["industryTaxonomy"] = "hubspot";
  if (defs && byId.get("currentCompanySubIndustry")?.values?.length) {
    industryTaxonomy = "lemlist";
    await lemlistSelect("industries", "currentCompanySubIndustry", true);
  } else {
    const ind = props.find((p) => p.name === "industry");
    if (ind) options.industries = ind.options.map((o) => ({ value: o.value, label: o.label }));
  }

  options.countries = COUNTRIES.map((c) => ({ value: c.value, label: c.label }));
  const sizeValues = byId.get("currentCompanyHeadcount")?.values?.length ? byId.get("currentCompanyHeadcount")!.values! : HEADCOUNT_FALLBACK;
  options.sizes = sizeValues.map((v) => ({ value: v, label: headcountLabel(v) }));
  const revValues = byId.get("currentCompanyRevenue")?.values?.length ? byId.get("currentCompanyRevenue")!.values! : REVENUE_FALLBACK;
  options.revenues = revValues.map((v) => ({ value: v, label: v.replace(/^<\s*/, "Menos de ").replace(/\+$/, " o más") }));

  if (defs) {
    await Promise.all([
      lemlistSelect("companyTypes", "currentCompanyType", true),
      lemlistSelect("markets", "currentCompanyMarket", false),
      lemlistSelect("regions", "currentCompanyRegion", true),
      lemlistSelect("funding", "currentCompanyLastFundingRoundAt", true),
      lemlistSelect("jobDate", "jobPostingDate", true),
    ]);
  }

  // Sin Lemlist solo se ofrecen los filtros que la base HubSpot puede aplicar
  const available = ALL_FILTERS.filter((d) => {
    if (!defs) return d.hubspot;
    if (d.lemlistFilterId && !byId.has(d.lemlistFilterId) && !d.hubspot) return false;
    if (d.control === "select" && !options[d.key]?.length) return false;
    return true;
  }).map((d) => d.key);

  return { lemlist: !!defs, industryTaxonomy, available, options };
}

// ── Traducción a filtros de Lemlist ──────────────────────────────────────

export function toLemlistFilters(f: UnifiedFilters): LemlistFilter[] {
  const out: LemlistFilter[] = [];
  for (const d of ALL_FILTERS) {
    if (!d.lemlistFilterId) continue;
    const values = filterValues(f, d.key);
    if (values.length) out.push({ filterId: d.lemlistFilterId, in: values, out: [] });
  }
  return out;
}

// ── Traducción a filtros de la base HubSpot ──────────────────────────────

const MAP_TOOL: Anthropic.Tool = {
  name: "industry_map",
  description: "Equivalencias de industria",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { lemlist_value: { type: "string" }, hubspot_values: { type: "array", items: { type: "string" } } },
          required: ["lemlist_value", "hubspot_values"],
        },
      },
    },
    required: ["items"],
  },
};

// Industria Lemlist (taxonomía LinkedIn nueva) → valores de industria HubSpot
async function mapIndustriesToHubspot(db: SupabaseClient, lemlistValues: string[], props: PoolProperty[]): Promise<string[]> {
  const hubspotOptions = props.find((p) => p.name === "industry")?.options ?? [];
  if (!lemlistValues.length || !hubspotOptions.length) return [];
  const { data } = await db.from("industry_value_map").select("lemlist_value, hubspot_values").in("lemlist_value", lemlistValues);
  const result = new Set<string>();
  const known = new Set<string>();
  for (const r of data ?? []) {
    known.add(r.lemlist_value);
    for (const v of r.hubspot_values ?? []) result.add(v);
  }
  const missing = lemlistValues.filter((v) => !known.has(v));
  if (missing.length) {
    try {
      const message = await anthropic().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 4000,
        temperature: 0,
        system: "Mapeas industrias entre dos taxonomías. Para cada industria de origen devuelve los valores EXACTOS de la lista destino que la cubren (1 a 4; lista vacía si ninguno calza razonablemente).",
        tools: [MAP_TOOL],
        tool_choice: { type: "tool", name: MAP_TOOL.name },
        messages: [{
          role: "user",
          content: `Origen:\n${missing.map((v) => `- ${v}`).join("\n")}\n\nDestino (value — label):\n${hubspotOptions.map((o) => `- ${o.value} — ${o.label}`).join("\n")}`,
        }],
      });
      void logAiUsage({ functionName: "portal_industry_map", model: HAIKU_MODEL, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
      const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const valid = new Set(hubspotOptions.map((o) => o.value));
      const items = ((block?.input as { items?: { lemlist_value: string; hubspot_values: string[] }[] })?.items ?? [])
        .filter((i) => missing.includes(i.lemlist_value))
        .map((i) => ({ lemlist_value: i.lemlist_value, hubspot_values: (i.hubspot_values ?? []).filter((v) => valid.has(v)) }));
      if (items.length) await db.from("industry_value_map").upsert(items, { onConflict: "lemlist_value" });
      for (const i of items) for (const v of i.hubspot_values) result.add(v);
    } catch (err) {
      console.error("mapIndustriesToHubspot:", err);
    }
  }
  return Array.from(result);
}

function techVariants(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    out.add(t);
    out.add(t.toLowerCase().replace(/\s+/g, "_"));
    out.add(t.toLowerCase().replace(/\s+/g, ""));
    out.add(t.toLowerCase().replace(/\s+/g, "-"));
  }
  return Array.from(out);
}

// applicable = false cuando el cliente usó algún filtro que la base HubSpot no
// tiene (región, ofertas de empleo…): mostrar resultados de HubSpot ignorando
// ese filtro sería engañoso. `lenient` (modo IA) aplica igual lo que se pueda.
export async function toPoolFilters(
  db: SupabaseClient,
  f: UnifiedFilters,
  catalog: Pick<FilterCatalog, "industryTaxonomy">,
  props: PoolProperty[],
  lenient = false
): Promise<{ applicable: boolean; filters: PoolFilter[]; query: string | null }> {
  const usesUnsupported = ALL_FILTERS.some((d) => !d.hubspot && filterValues(f, d.key).length > 0);
  if (usesUnsupported && !lenient) return { applicable: false, filters: [], query: null };

  const filters: PoolFilter[] = [];
  const industries = filterValues(f, "industries");
  if (industries.length) {
    const hs = catalog.industryTaxonomy === "lemlist" ? await mapIndustriesToHubspot(db, industries, props) : industries;
    if (!hs.length) return { applicable: false, filters: [], query: null };
    filters.push({ property: "industry", op: "in", values: hs });
  }
  const countries = filterValues(f, "countries");
  if (countries.length) {
    const hs = countries.flatMap((c) => COUNTRIES.find((x) => x.value === c)?.hubspot ?? [c]);
    filters.push({ property: "pais_g", op: "in", values: hs });
  }
  const cities = filterValues(f, "cities");
  if (cities.length) filters.push({ property: "city", op: "in", values: cities });

  const size = unionRange(filterValues(f, "sizes").map(parseHeadcountBucket));
  if (size) filters.push({ property: "numberofemployees", op: "range", min: size.min, max: size.max });
  const revenue = unionRange(filterValues(f, "revenues").map(parseRevenueBucket));
  if (revenue) filters.push({ property: "annualrevenue", op: "range", min: revenue.min, max: revenue.max });

  const techs = filterValues(f, "technologies");
  if (techs.length) filters.push({ property: "web_technologies", op: "in", values: techVariants(techs) });

  const keyword = filterValues(f, "keyword")[0] ?? null;
  return { applicable: true, filters, query: keyword };
}

// ── Búsqueda paginada: HubSpot primero, luego Lemlist ────────────────────

export async function runUnifiedSearch(
  db: SupabaseClient,
  opts: {
    filters: UnifiedFilters;
    cursor: SearchCursor;
    pageSize: number;
    exclusions: ClientExclusions;
    lemlistKey: string | null;
    catalog: Pick<FilterCatalog, "industryTaxonomy">;
    lenient?: boolean;
  }
): Promise<{ cards: CompanyCard[]; next: SearchCursor; needsFilters: boolean }> {
  const props = await listPoolProperties(db);
  let cursor = { ...opts.cursor };
  const cards: CompanyCard[] = [];
  let needsFilters = false;

  if (cursor.phase === "hubspot") {
    const pool = await toPoolFilters(db, opts.filters, opts.catalog, props, opts.lenient);
    if (pool.applicable) {
      const r = await searchPool(db, {
        filters: pool.filters,
        query: pool.query,
        excludeDomains: opts.exclusions.domains,
        excludeNames: opts.exclusions.names,
        excludeKeywords: opts.exclusions.keywords,
        limit: opts.pageSize,
        offset: cursor.hsOffset,
      });
      cards.push(...r.companies.map((c) => poolCompanyToCard(c, props)));
      cursor = r.companies.length === opts.pageSize ? { ...cursor, hsOffset: cursor.hsOffset + opts.pageSize } : { ...cursor, phase: "lemlist" };
    } else {
      cursor = { ...cursor, phase: "lemlist" };
    }
  }

  // Si HubSpot no llenó la página, se completa con Lemlist en la misma respuesta
  if (cursor.phase === "lemlist" && cards.length < opts.pageSize) {
    const lemFilters = toLemlistFilters(opts.filters);
    if (!opts.lemlistKey) {
      cursor = { ...cursor, phase: "done" };
    } else if (!lemFilters.length) {
      // Lemlist exige al menos un filtro
      needsFilters = true;
      cursor = { ...cursor, phase: "done" };
    } else {
      const r = await searchLemlistCompanies(opts.lemlistKey, { filters: lemFilters, page: cursor.lemPage, size: opts.pageSize });
      if (r.ok) {
        cards.push(...r.data.companies.map(lemlistCompanyToCard).filter((c) => !isExcluded(opts.exclusions, c.name, c.domain)));
        const exhausted = r.data.companies.length < opts.pageSize || (r.data.total != null && cursor.lemPage * opts.pageSize >= r.data.total);
        cursor = exhausted ? { ...cursor, phase: "done" } : { ...cursor, lemPage: cursor.lemPage + 1 };
      } else {
        console.error("Lemlist search:", r.status, r.error);
        cursor = { ...cursor, phase: "done" };
      }
    }
  }

  return { cards, next: cursor, needsFilters };
}

export function parseCursor(raw: unknown): SearchCursor {
  const c = raw as Partial<SearchCursor> | null;
  if (!c || !["hubspot", "lemlist", "done"].includes(String(c.phase))) return { ...FIRST_CURSOR };
  return {
    phase: c.phase as SearchCursor["phase"],
    hsOffset: Math.max(0, Math.min(100_000, Number(c.hsOffset) || 0)),
    lemPage: Math.max(1, Math.min(500, Number(c.lemPage) || 1)),
  };
}

// Sanea lo que manda el navegador: solo claves conocidas, valores acotados
export function sanitizeUnifiedFilters(raw: unknown): UnifiedFilters {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: UnifiedFilters = {};
  for (const d of ALL_FILTERS) {
    const v = src[d.key];
    if (d.control === "text" || d.control === "longtext") {
      if (typeof v === "string" && v.trim()) out[d.key] = v.trim().slice(0, 300);
    } else if (Array.isArray(v)) {
      const list = v.map((x) => String(x).trim().slice(0, 150)).filter(Boolean).slice(0, 40);
      if (list.length) out[d.key] = list;
    }
  }
  return out;
}

// Referencia opaca de una empresa en resultados (el navegador no ve de qué
// base viene: solo devuelve esta ref al puntuar o agregar)
export function encodeRef(source: "hubspot" | "lemlist", key: string): string {
  return Buffer.from(JSON.stringify([source === "hubspot" ? "b" : "x", key])).toString("base64url");
}

export function decodeRef(ref: unknown): { source: "hubspot" | "lemlist"; key: string } | null {
  if (typeof ref !== "string" || ref.length > 400) return null;
  try {
    const [s, k] = JSON.parse(Buffer.from(ref, "base64url").toString("utf8"));
    if ((s !== "b" && s !== "x") || typeof k !== "string" || !k) return null;
    return { source: s === "b" ? "hubspot" : "lemlist", key: k.slice(0, 200) };
  } catch {
    return null;
  }
}

// Tarjeta tal como la ve el cliente (sin fuente)
export type PublicCard = Omit<CompanyCard, "source" | "key"> & { ref: string };
export function toPublicCard(c: CompanyCard): PublicCard {
  const { source, key, ...rest } = c;
  return { ...rest, ref: encodeRef(source, key) };
}
