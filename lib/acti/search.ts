import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listPoolProperties, normalizeDomain, pickAllowed } from "@/lib/hubspotPool";
import { cardSummary, getClientExclusions, getClientIcpText, poolCompanyToCard } from "@/lib/wishlist";
import { icpHash, scoreCompanies } from "@/lib/wishlistFit";
import { encodeRef } from "@/lib/unifiedSearch";
import { deserializeIcpForm } from "@/lib/icp-form";

// ACTI · Buscar cuentas → Base de empresas. Busca en la base de empresas de
// BullsEye (hubspot_company_pool) con las funciones acti_pool_search /
// acti_pool_facets (migración Fase 2), y calcula el fit con el MISMO motor y
// la MISMA caché que Empresas (scoreCompanies, fuente "unified", clave
// "hubspot:<hs_id>"): un fit calculado para el socio sirve al equipo y al revés.

export type ActiFilters = {
  q?: string;
  industry?: string[];
  country?: string[];
  city?: string[];
  size?: string[];
  revenue?: string[];
  tech?: string[];
  area?: string[];
  level?: string[];
  mobile?: boolean;
  title?: string;
};

export const FACETS = ["industry", "country", "city", "size", "revenue", "tech", "area", "level", "signal"] as const;
export type Facet = (typeof FACETS)[number];

const LIST_KEYS = ["industry", "country", "city", "size", "revenue", "tech", "area", "level"] as const;

export function sanitizeFilters(raw: unknown): ActiFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ActiFilters = {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  out.q = str(r.q, 100);
  out.title = str(r.title, 60);
  if (r.mobile === true) out.mobile = true;
  for (const k of LIST_KEYS) {
    const v = r[k];
    if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 30);
      if (list.length) out[k] = list;
    }
  }
  return out;
}

export const filtersKey = (f: ActiFilters) => crypto.createHash("sha1").update(JSON.stringify(f)).digest("hex").slice(0, 16);

export type PeopleSummary = { contacts: number; mobiles: number; areas: string[]; levels: string[] };

export type ActiCompanyCard = {
  ref: string;
  hsId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  employees: string | null;
  description: string | null;
  website: string | null;
  linkedin: string | null;
  people: PeopleSummary;
  fit: { score: number; reason: string } | null;
};

type PoolRow = {
  hs_id: string;
  name: string;
  domain: string | null;
  properties: Record<string, unknown>;
  contacts?: number;
  mobiles?: number;
  areas?: string[];
  levels?: string[];
  total_count?: number | string;
};

const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

export function rowToCard(r: PoolRow): ActiCompanyCard {
  const p = pickAllowed(r.properties ?? {});
  return {
    ref: encodeRef("hubspot", r.hs_id),
    hsId: r.hs_id,
    name: r.name,
    domain: r.domain,
    industry: s(p.industry),
    country: s(p.pais_g),
    city: s(p.city),
    employees: s(p.numberofemployees),
    description: s(p.description)?.slice(0, 400) ?? null,
    website: s(p.website),
    linkedin: s(p.linkedin_company_page),
    people: { contacts: r.contacts ?? 0, mobiles: r.mobiles ?? 0, areas: r.areas ?? [], levels: r.levels ?? [] },
    fit: null,
  };
}

// Exclusiones del socio: las de siempre (wishlist, trabajadas, exclusión,
// omitidas…) + lo que ya pidió en ACTI y aún no pasa a la wishlist.
export async function actiExclusions(db: SupabaseClient, clientId: string) {
  const ex = await getClientExclusions(db, clientId);
  const { data } = await db.from("acti_requests").select("domain, company_name").eq("client_id", clientId).neq("status", "cancelada");
  const domains = new Set(ex.domains);
  const names = new Set(ex.names);
  for (const r of (data ?? []) as { domain: string | null; company_name: string }[]) {
    if (r.domain) domains.add(r.domain);
    names.add(r.company_name.trim().toLowerCase());
  }
  return { domains: [...domains], names: [...names], keywords: ex.keywords };
}

export async function searchCompanies(
  db: SupabaseClient,
  clientId: string,
  f: ActiFilters,
  page: number,
  pageSize = 24
): Promise<{ cards: ActiCompanyCard[]; total: number }> {
  const ex = await actiExclusions(db, clientId);
  const { data, error } = await db.rpc("acti_pool_search", {
    f,
    ex_domains: ex.domains,
    ex_names: ex.names,
    ex_keywords: ex.keywords,
    p_order: "contactos",
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PoolRow[];
  return { cards: rows.map(rowToCard), total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

export type FacetCounts = Record<Facet, { value: string; n: number }[]>;

// Conteos por opción. Se cachean 10 min por cliente + filtros (la consulta
// recorre toda la base de empresas).
export async function facetCounts(db: SupabaseClient, clientId: string, f: ActiFilters): Promise<FacetCounts> {
  const key = `acti_facets:${clientId}:${filtersKey(f)}`;
  const { data: hit } = await db.from("allo_response_cache").select("response, expires_at").eq("cache_key", key).maybeSingle();
  if (hit && new Date(hit.expires_at as string).getTime() > Date.now()) return hit.response as FacetCounts;

  const ex = await actiExclusions(db, clientId);
  const { data, error } = await db.rpc("acti_pool_facets", { f, ex_domains: ex.domains, ex_names: ex.names, ex_keywords: ex.keywords });
  if (error) throw new Error(error.message);
  const out = Object.fromEntries(FACETS.map((k) => [k, [] as { value: string; n: number }[]])) as FacetCounts;
  for (const r of (data ?? []) as { facet: Facet; value: string; n: number | string }[]) {
    if (out[r.facet]) out[r.facet].push({ value: r.value, n: Number(r.n) });
  }
  await db.from("allo_response_cache").upsert(
    { cache_key: key, response: out, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() },
    { onConflict: "cache_key" }
  );
  return out;
}

// Fit con el motor actual. `compute` = evaluar con IA las que no están en caché.
export async function attachFit(db: SupabaseClient, clientId: string, cards: ActiCompanyCard[], compute: boolean) {
  if (!cards.length) return { icpMissing: false };
  const icpText = await getClientIcpText(db, clientId);
  if (!icpText.trim()) return { icpMissing: true };
  const keys = cards.map((c) => `hubspot:${c.hsId}`);

  const { data: cached } = await db
    .from("company_fit_scores")
    .select("source_key, fit_score, fit_reason")
    .eq("client_id", clientId)
    .eq("source", "unified")
    .eq("icp_hash", icpHash(icpText))
    .in("source_key", keys);
  const fits = new Map<string, { score: number; reason: string }>();
  for (const r of (cached ?? []) as { source_key: string; fit_score: number; fit_reason: string }[]) {
    fits.set(r.source_key, { score: r.fit_score, reason: r.fit_reason.replace(/^\[CLIENTE_ACTUAL\]\s*/, "") });
  }

  const missing = cards.filter((c) => !fits.has(`hubspot:${c.hsId}`));
  if (compute && missing.length) {
    const [{ data: rows }, props] = await Promise.all([
      db.from("hubspot_company_pool").select("hs_id, name, domain, properties").in("hs_id", missing.map((c) => c.hsId)),
      listPoolProperties(db),
    ]);
    const candidates = ((rows ?? []) as PoolRow[]).map((r) => {
      const card = poolCompanyToCard(r, props);
      return { key: `hubspot:${r.hs_id}`, name: card.name, summary: cardSummary(card) };
    });
    const scores = await scoreCompanies(db, { clientId, icpText, source: "unified", candidates });
    for (const [k, v] of scores) fits.set(k, { score: v.fit_score, reason: v.fit_reason });
  }
  for (const c of cards) c.fit = fits.get(`hubspot:${c.hsId}`) ?? null;
  return { icpMissing: false };
}

// Áreas / niveles del ICP del socio con el vocabulario de la tabla de cargos
// (para destacar los perfiles que calzan)
const AREA_MAP: Record<string, string> = {
  Ventas: "Comercial", "Revenue Ops": "Comercial", Canales: "Comercial", "Experiencia del Cliente": "Comercial",
  Marketing: "Marketing", Operaciones: "Operaciones", "C-Suite": "Gerencia General", Producto: "Tecnología",
  Tecnología: "Tecnología", RRHH: "RRHH",
};
const LEVEL_MAP: Record<string, string> = {
  Manager: "Gerente", "Senior Manager": "Gerente", Director: "Director", "VP / Head of": "Director",
  "C-Level": "C-Level", "Founder / Owner": "C-Level",
};

export async function icpPersonaTargets(db: SupabaseClient, clientId: string) {
  const form = deserializeIcpForm(await getClientIcpText(db, clientId));
  return {
    areas: [...new Set(form.departamentos.map((d) => AREA_MAP[d]).filter(Boolean))],
    levels: [...new Set(form.seniority.map((d) => LEVEL_MAP[d]).filter(Boolean))],
  };
}

export async function peopleFor(db: SupabaseClient, domains: (string | null)[]): Promise<Map<string, PeopleSummary>> {
  const list = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  const out = new Map<string, PeopleSummary>();
  if (!list.length) return out;
  const { data } = await db.from("acti_company_people").select("domain, contacts, mobiles, areas, levels").in("domain", list);
  for (const r of (data ?? []) as (PeopleSummary & { domain: string })[]) {
    out.set(r.domain, { contacts: r.contacts, mobiles: r.mobiles, areas: r.areas ?? [], levels: r.levels ?? [] });
  }
  return out;
}
