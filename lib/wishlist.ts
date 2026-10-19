import type { SupabaseClient } from "@supabase/supabase-js";
import { listClientIndustries, loadIcpContent } from "./icpStore";
import { normalizeDomain, pickAllowed, type PoolCompany, type PoolProperty } from "./hubspotPool";
import type { LemlistCompany } from "./lemlistDatabase";

// Helpers compartidos de la wishlist del portal (búsqueda, IA y alta).

// ICP completo del cliente para la IA: el general + el de cada industria
export async function getClientIcpText(db: SupabaseClient, clientId: string): Promise<string> {
  const parts: string[] = [];
  const general = await loadIcpContent(db, clientId, null);
  if (general.trim()) parts.push(general.trim());
  for (const ind of await listClientIndustries(db, clientId)) {
    const content = await loadIcpContent(db, clientId, ind.id);
    if (content.trim()) parts.push(`=== ICP INDUSTRIA: ${ind.name} ===\n${content.trim()}`);
  }
  return parts.join("\n\n");
}

export const normName = (s: string) => s.trim().toLowerCase();

// Empresas que NO deben volver a aparecerle al cliente: las de su wishlist,
// las excluidas por BullsEye y las que ya están en su pipeline (companies).
export async function getClientExclusions(
  db: SupabaseClient,
  clientId: string
): Promise<{ domains: string[]; names: string[] }> {
  const domains = new Set<string>();
  const names = new Set<string>();
  const add = (name?: string | null, website?: string | null) => {
    if (name?.trim()) names.add(normName(name));
    const d = normalizeDomain(website ?? null);
    if (d) domains.add(d);
  };

  const [wishlist, excluded] = await Promise.all([
    db.from("client_wishlist").select("company_name, domain").eq("client_id", clientId),
    db.from("excluded_companies").select("company_name, company_website").eq("client_id", clientId),
  ]);
  for (const r of wishlist.data ?? []) add(r.company_name, r.domain);
  for (const r of excluded.data ?? []) add(r.company_name, r.company_website);

  // companies puede tener miles de filas por cliente: se pagina
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await db
      .from("companies")
      .select("company_name, company_website")
      .eq("client_id", clientId)
      .range(from, from + 999);
    for (const r of data ?? []) add(r.company_name, r.company_website);
    if (!data || data.length < 1000) break;
  }

  return { domains: Array.from(domains), names: Array.from(names) };
}

export function isExcluded(ex: { domains: string[]; names: string[] }, name: string, domain: string | null) {
  return (domain && ex.domains.includes(domain)) || ex.names.includes(normName(name));
}

// Tarjeta que ve el cliente (y snapshot que se guarda al agregarla)
export type CompanyCard = {
  source: "hubspot" | "lemlist";
  key: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  facts: { label: string; value: string }[];
  fit_score?: number | null;
  fit_reason?: string | null;
};

const PRIORITY_PROPS = [
  "industry", "numberofemployees", "annualrevenue", "pais_g", "city", "state",
  "web_technologies", "description", "founded_year", "linkedin_company_page",
];

function factValue(v: unknown): string {
  if (Array.isArray(v)) return v.slice(0, 12).join(", ") + (v.length > 12 ? "…" : "");
  if (typeof v === "number") return v.toLocaleString("es-CL");
  return String(v);
}

export function poolCompanyToCard(c: PoolCompany, props: PoolProperty[]): CompanyCard {
  const labels = new Map(props.map((p) => [p.name, p]));
  const optionLabel = (prop: string, value: string) =>
    labels.get(prop)?.options.find((o) => o.value === value)?.label ?? value;

  const allowed = pickAllowed(c.properties);
  const keys = Object.keys(allowed).filter((k) => labels.has(k));
  keys.sort((a, b) => {
    const ia = PRIORITY_PROPS.indexOf(a);
    const ib = PRIORITY_PROPS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const facts = keys.map((k) => {
    const raw = allowed[k];
    const value = Array.isArray(raw)
      ? factValue(raw.map((v) => optionLabel(k, String(v))))
      : typeof raw === "string"
        ? optionLabel(k, raw)
        : factValue(raw);
    return { label: labels.get(k)!.label, value: value.length > 400 ? `${value.slice(0, 400)}…` : value };
  });

  const linkedin = allowed.linkedin_company_page;
  return {
    source: "hubspot",
    key: c.hs_id,
    name: c.name,
    domain: c.domain,
    linkedin_url: typeof linkedin === "string" ? linkedin : null,
    facts,
  };
}

export function lemlistCompanyToCard(c: LemlistCompany): CompanyCard {
  const facts = [
    ["Industria", c.industry],
    ["Tamaño", c.size],
    ["Facturación", c.revenue],
    ["Ubicación", c.location],
    ["Tecnologías", c.technologies.length ? c.technologies.slice(0, 12).join(", ") + (c.technologies.length > 12 ? "…" : "") : null],
    ["Mercado", c.market],
    ["Tipo", c.company_type],
    ["Fundada", c.founded],
    ["Descripción", c.description],
  ]
    .filter(([, v]) => v)
    .map(([label, value]) => ({ label: label as string, value: (value as string).slice(0, 400) }));
  return { source: "lemlist", key: c.id, name: c.name, domain: c.domain, linkedin_url: c.linkedin_url, facts };
}

// Datos para crear la empresa en el CRM de Lemlist del cliente
export type LemlistCompanyFields = { industry?: string | null; location?: string | null; size?: string | null; description?: string | null };

export function poolCompanyLemlistFields(c: PoolCompany, props: PoolProperty[]): LemlistCompanyFields {
  const p = pickAllowed(c.properties);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const industryRaw = str(p.industry);
  const industry = industryRaw
    ? props.find((x) => x.name === "industry")?.options.find((o) => o.value === industryRaw)?.label ?? industryRaw
    : null;
  return {
    industry,
    location: [str(p.city), str(p.state), str(p.pais_g)].filter(Boolean).join(", ") || null,
    size: str(p.numberofemployees),
    description: str(p.description),
  };
}

export function cardLemlistFields(card: CompanyCard): LemlistCompanyFields {
  const get = (label: string) => card.facts.find((f) => f.label === label)?.value ?? null;
  return { industry: get("Industria"), location: get("Ubicación"), size: get("Tamaño"), description: get("Descripción") };
}

// Texto compacto de la empresa para el prompt de fit
export function cardSummary(card: CompanyCard): string {
  return [card.domain ? `Dominio: ${card.domain}` : null, ...card.facts.map((f) => `${f.label}: ${f.value}`)]
    .filter(Boolean)
    .join("\n");
}
