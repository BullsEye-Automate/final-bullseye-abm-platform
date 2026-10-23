import type { SupabaseClient } from "@supabase/supabase-js";

// Base de datos B2B de Lemlist, consultada con la API key PROPIA de cada
// cliente (client_configs.lemlist_api_key). A diferencia de getLemlistApiKey(),
// acá NO se cae a la key global de BullsEye: lo acordado es que las búsquedas
// y las empresas queden en la cuenta del cliente.
//
// Endpoints (OpenAPI oficial: github.com/l3mpire/mintlify → api-reference/openapi/v2.json):
//  - GET  /database/filters?usage=api&mode=companies
//  - POST /database/companies  { filters: [{ filterId, in: [], out: [] }], page, size }
//    Exige al menos un filtro y cada filtro con `in` Y `out` (aunque vacío);
//    si no, responde 400 "Parameter filters is invalid". El texto libre va
//    como filtro keywordInCompany.
//  - POST /companies                          crea/actualiza (upsert por dominio/LinkedIn) → cpn_xxx
//  - GET/POST /companies/lists                listas de empresas (clt_xxx)
//  - POST /companies/lists/{listId}/entities  { companyIds: ["cpn_xxx"] }
//
// Tipos de filtro de Lemlist: select (con values), autocomplete y text (texto
// libre en `in`), slider (rango), static (toggle), elasticId (ids). Por ahora
// el portal usa solo select / autocomplete / text: el formato de slider y
// static no está confirmado.

const LEMLIST_API = "https://api.lemlist.com/api";

export async function getClientOwnLemlistKey(db: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await db.from("client_configs").select("lemlist_api_key").eq("client_id", clientId).maybeSingle();
  const key = (data as { lemlist_api_key?: string | null } | null)?.lemlist_api_key?.trim();
  return key || null;
}

function headers(apiKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

export type LemlistFilterDef = {
  filterId: string;
  description: string;
  type: string;
  mode?: string[];
  values?: string[];
  range?: { min?: number; max?: number };
};

export type LemlistFilter = { filterId: string; in?: string[]; out?: string[] };

export const SUPPORTED_FILTER_TYPES = new Set(["select", "autocomplete", "text"]);
// Filtro de texto libre sobre nombre + descripción de la empresa
export const KEYWORD_FILTER_ID = "keywordInCompany";

// "Company industry: Filter by…" → "Company industry"
export function lemlistFilterLabel(def: { filterId: string; description: string }): string {
  const head = def.description.split(":")[0]?.trim();
  return head && head.length <= 60 ? head : def.filterId;
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(apiKey: string, path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(`${LEMLIST_API}${path}`, { ...init, headers: headers(apiKey), cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getLemlistCompanyFilters(apiKey: string): Promise<Result<LemlistFilterDef[]>> {
  const r = await call<unknown>(apiKey, "/database/filters?usage=api&mode=companies");
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : ((r.data as { filters?: unknown[] })?.filters ?? []);
  const defs = (list as Record<string, unknown>[])
    .map((f) => ({
      filterId: String(f.filterId ?? f.id ?? ""),
      description: String(f.description ?? f.label ?? f.filterId ?? ""),
      type: String(f.type ?? "text"),
      mode: Array.isArray(f.mode) ? (f.mode as string[]) : undefined,
      values: Array.isArray(f.values) ? (f.values as unknown[]).map(String) : undefined,
      range: (f.range as LemlistFilterDef["range"]) ?? undefined,
    }))
    .filter((f) => f.filterId && (!f.mode || f.mode.includes("companies")) && SUPPORTED_FILTER_TYPES.has(f.type));
  return { ok: true, data: defs };
}

// Empresa normalizada para el portal (campos según la respuesta documentada
// de /database/companies)
export type LemlistCompany = {
  id: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  industry: string | null;
  size: string | null;
  revenue: string | null;
  location: string | null;
  technologies: string[];
  company_type: string | null;
  market: string | null;
  founded: string | null;
  description: string | null;
};

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// Hosts técnicos (CDN, hosting) que a veces vienen como "dominio" y no son
// el sitio de la empresa: se descartan para no crear empresas con dominio basura
const JUNK_DOMAIN_SUFFIXES = [
  "cloudfront.net", "amazonaws.com", "herokuapp.com", "azurewebsites.net", "netlify.app",
  "vercel.app", "github.io", "wixsite.com", "squarespace.com", "godaddysites.com",
  "linkedin.com", "facebook.com", "instagram.com", "google.com", "sites.google.com",
];

export function cleanDomain(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || null;
  if (!d || !d.includes(".")) return null;
  return JUNK_DOMAIN_SUFFIXES.some((j) => d === j || d.endsWith(`.${j}`)) ? null : d;
}

// Lista de tecnologías: acepta strings u objetos ({ name }) y quita repetidos
function techList(o: Record<string, unknown>): string[] {
  const raw = [o.technologies, o.techno_used_array].find((v) => Array.isArray(v) && v.length) as unknown[] | undefined;
  const names = (raw ?? [])
    .map((t) => (typeof t === "string" ? t : (t as { name?: unknown })?.name))
    .filter((t): t is string => typeof t === "string" && !!t.trim())
    .map((t) => t.trim());
  return Array.from(new Set(names));
}

function normalizeCompany(o: Record<string, unknown>): LemlistCompany | null {
  const name = pickStr(o, "company_name", "name", "companyName");
  if (!name) return null;
  const domain =
    cleanDomain(pickStr(o, "company_domain", "domain")) ?? cleanDomain(pickStr(o, "company_website_url", "website"));
  const industry = [pickStr(o, "company_industry", "industry"), pickStr(o, "company_subindustry")].filter(Boolean).join(" › ");
  const employees = pickStr(o, "company_employee_count");
  const sizeBucket = pickStr(o, "company_size", "size");
  const techs = techList(o);
  return {
    id: pickStr(o, "company_id", "_id", "id") ?? domain ?? name,
    name,
    domain,
    linkedin_url: pickStr(o, "company_linkedin_url", "linkedinUrl"),
    industry: industry || null,
    size: [sizeBucket, employees ? `${employees} empleados` : null].filter(Boolean).join(" · ") || null,
    revenue: pickStr(o, "revenue_bucket"),
    // Sede (ciudad + país) primero: company_location a veces no calza con la sede
    location:
      [pickStr(o, "company_headquarters_city"), pickStr(o, "company_headquarters_country")].filter(Boolean).join(", ") ||
      pickStr(o, "company_location"),
    technologies: techs,
    company_type: pickStr(o, "company_type"),
    market: pickStr(o, "business_business_customer"),
    founded: pickStr(o, "company_founded"),
    description: pickStr(o, "company_description", "description"),
  };
}

export async function searchLemlistCompanies(
  apiKey: string,
  body: { filters: LemlistFilter[]; search?: string; page: number; size: number }
): Promise<Result<{ companies: LemlistCompany[]; total: number | null; rawKeys: string[]; rawSample: unknown }>> {
  // Lemlist exige `in` y `out` en cada filtro, aunque uno vaya vacío
  const filters = body.filters
    .filter((f) => f.in?.length || f.out?.length)
    .map((f) => ({ filterId: f.filterId, in: f.in ?? [], out: f.out ?? [] }));
  // El texto libre se manda como filtro keywordInCompany (se suma al que ya haya)
  const search = body.search?.trim();
  if (search) {
    const existing = filters.find((f) => f.filterId === KEYWORD_FILTER_ID);
    if (existing) existing.in = [...existing.in, search];
    else filters.push({ filterId: KEYWORD_FILTER_ID, in: [search], out: [] });
  }
  if (!filters.length) {
    return { ok: false, status: 400, error: "Agrega al menos un filtro o una palabra clave para buscar en Lemlist." };
  }
  const payload: Record<string, unknown> = {
    filters,
    page: body.page,
    size: Math.min(Math.max(body.size, 1), 100),
  };

  const r = await call<Record<string, unknown>>(apiKey, "/database/companies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) return r;
  const results = (r.data?.results ?? r.data?.companies ?? r.data?.data ?? []) as Record<string, unknown>[];
  const companies = results.map(normalizeCompany).filter((c): c is LemlistCompany => !!c);
  const totalRaw = r.data?.total ?? r.data?.totalCount ?? r.data?.count;
  return {
    ok: true,
    data: {
      companies,
      total: typeof totalRaw === "number" ? totalRaw : null,
      // Nombres de campos que devuelve Lemlist (para ajustar normalizeCompany)
      rawKeys: results[0] ? Object.keys(results[0]) : Object.keys(r.data ?? {}),
      // Primer resultado tal como llega (solo para el diagnóstico interno)
      rawSample: results[0] ?? r.data,
    },
  };
}

// ── Escritura en la cuenta Lemlist del cliente ───────────────────────────

export const WISHLIST_LIST_NAME = "Wishlist BullsEye";

// Crea o actualiza la empresa en el CRM de Lemlist del cliente → id cpn_xxx.
// Upsert por dominio / LinkedIn: si ya existía, no se duplica.
export async function upsertLemlistCompany(
  apiKey: string,
  c: { name: string; domain?: string | null; linkedinUrl?: string | null; industry?: string | null; location?: string | null; size?: string | null; description?: string | null }
): Promise<Result<{ companyId: string }>> {
  if (!c.domain && !c.linkedinUrl) {
    return { ok: false, status: 400, error: "La empresa no tiene dominio ni LinkedIn: Lemlist exige uno de los dos." };
  }
  const body: Record<string, string> = { name: c.name };
  if (c.domain) body.domain = c.domain;
  if (c.linkedinUrl) body.linkedinUrl = c.linkedinUrl;
  if (c.industry) body.industry = c.industry.slice(0, 200);
  if (c.location) body.location = c.location.slice(0, 200);
  if (c.size) body.size = c.size.slice(0, 100);
  if (c.description) body.description = c.description.slice(0, 2000);

  // fillEmptyOnly: si la empresa ya estaba en su Lemlist, no pisamos lo que tienen
  const r = await call<{ data?: { _id?: string } }>(apiKey, "/companies?updateStrategy=fillEmptyOnly", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  const id = r.data?.data?._id;
  return id ? { ok: true, data: { companyId: id } } : { ok: false, status: 0, error: "Lemlist no devolvió el id de la empresa" };
}

// Busca la lista estática "Wishlist BullsEye" en la cuenta del cliente o la crea
export async function ensureWishlistCompanyList(apiKey: string): Promise<Result<{ listId: string }>> {
  const found = await call<{ _id: string; name: string; dynamic?: boolean }[]>(
    apiKey,
    `/companies/lists?search=${encodeURIComponent(WISHLIST_LIST_NAME)}`
  );
  if (!found.ok) return found;
  const existing = (found.data ?? []).find((l) => l.name === WISHLIST_LIST_NAME && !l.dynamic);
  if (existing) return { ok: true, data: { listId: existing._id } };

  const created = await call<{ list?: { id?: string } }>(apiKey, "/companies/lists", {
    method: "POST",
    body: JSON.stringify({ name: WISHLIST_LIST_NAME }),
  });
  if (!created.ok) return created;
  const id = created.data?.list?.id;
  return id ? { ok: true, data: { listId: id } } : { ok: false, status: 0, error: "Lemlist no devolvió el id de la lista" };
}

export async function addCompaniesToList(apiKey: string, listId: string, companyIds: string[]): Promise<Result<unknown>> {
  return call(apiKey, `/companies/lists/${encodeURIComponent(listId)}/entities`, {
    method: "POST",
    body: JSON.stringify({ companyIds }),
  });
}

export async function removeCompaniesFromList(apiKey: string, listId: string, companyIds: string[]): Promise<Result<unknown>> {
  return call(apiKey, `/companies/lists/${encodeURIComponent(listId)}/entities?action=remove`, {
    method: "POST",
    body: JSON.stringify({ companyIds }),
  });
}

// ── Personas (contactos de las empresas de la wishlist) ──────────────────
//  - GET  /database/filters?usage=api&mode=people
//  - POST /database/people   { filters, page, size }  sin créditos; cupo de búsquedas cada 24 h (`limitation`)
//  - POST /contacts          upsert por email / LinkedIn → ctc_xxx (se puede ligar a la empresa con companyId)
//  - GET/POST /contacts/lists, POST /contacts/lists/{id}/entities { contactIds }
//  - POST /enrich?findEmail&findPhone…  → enr_xxx; resultado en GET /enrich/{id} (gasta créditos)

export async function getLemlistPeopleFilters(apiKey: string): Promise<Result<LemlistFilterDef[]>> {
  const r = await call<unknown>(apiKey, "/database/filters?usage=api&mode=people");
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : ((r.data as { filters?: unknown[] })?.filters ?? []);
  const defs = (list as Record<string, unknown>[])
    .map((f) => ({
      filterId: String(f.filterId ?? f.id ?? ""),
      description: String(f.description ?? f.label ?? f.filterId ?? ""),
      type: String(f.type ?? "text"),
      values: Array.isArray(f.values) ? (f.values as unknown[]).map((v) => (typeof v === "object" && v ? String((v as { value?: unknown; label?: unknown }).value ?? (v as { label?: unknown }).label ?? "") : String(v))) : undefined,
    }))
    .filter((f) => f.filterId);
  return { ok: true, data: defs };
}

export type LemlistPerson = {
  lead_id: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  location: string | null;
  seniority: string | null;
  department: string | null;
  summary: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
};

function normalizePerson(p: Record<string, unknown>): LemlistPerson | null {
  const id = pickStr(p, "lead_id", "_id", "id");
  const name = pickStr(p, "full_name", "fullName", "name");
  if (!id || !name) return null;
  // Experiencia actual: la marcada como principal, si no la primera sin fecha de término
  const exps = (Array.isArray(p.experiences) ? p.experiences : []) as Record<string, unknown>[];
  const current = exps.find((e) => e.main_in_profile === true) ?? exps.find((e) => !e.date_to) ?? exps[0] ?? {};
  const dept = p.department;
  return {
    lead_id: id,
    full_name: name,
    title: pickStr(p, "title") ?? pickStr(current, "title"),
    linkedin_url: pickStr(p, "lead_linkedin_url", "linkedin_url", "linkedinUrl"),
    // Ubicación + país (a veces la ubicación trae solo la ciudad)
    location: (() => {
      const loc = pickStr(p, "location");
      const country = pickStr(p, "country");
      if (loc && country && !loc.toLowerCase().includes(country.toLowerCase())) return `${loc}, ${country}`;
      return loc ?? country;
    })(),
    seniority: pickStr(p, "seniority"),
    department: Array.isArray(dept) ? dept.map(String).join(", ") || null : pickStr(p, "department"),
    summary: pickStr(p, "summary")?.slice(0, 400) ?? null,
    company_name: pickStr(p, "current_exp_company_name") ?? pickStr(current, "company_name"),
    company_domain: cleanDomain(pickStr(current, "company_domain", "company_website_url")),
    company_linkedin_url: pickStr(current, "company_linkedin_url"),
  };
}

export async function searchLemlistPeople(
  apiKey: string,
  body: { filters: LemlistFilter[]; page: number; size: number }
): Promise<Result<{ people: LemlistPerson[]; total: number | null; limitation: number | null }>> {
  const filters = body.filters
    .filter((f) => f.in?.length || f.out?.length)
    .map((f) => ({ filterId: f.filterId, in: f.in ?? [], out: f.out ?? [] }));
  if (!filters.length) return { ok: false, status: 400, error: "Falta al menos un filtro" };
  const r = await call<Record<string, unknown>>(apiKey, "/database/people", {
    method: "POST",
    body: JSON.stringify({ filters, page: body.page, size: Math.min(Math.max(body.size, 1), 100) }),
  });
  if (!r.ok) return r;
  const results = (r.data?.results ?? r.data?.people ?? r.data?.data ?? []) as Record<string, unknown>[];
  const total = r.data?.total;
  const limitation = r.data?.limitation;
  return {
    ok: true,
    data: {
      people: results.map(normalizePerson).filter((x): x is LemlistPerson => !!x),
      total: typeof total === "number" ? total : null,
      limitation: typeof limitation === "number" ? limitation : null,
    },
  };
}

export const WISHLIST_CONTACT_LIST_NAME = "Contactos Wishlist BullsEye";

export async function ensureContactList(apiKey: string, name = WISHLIST_CONTACT_LIST_NAME): Promise<Result<{ listId: string }>> {
  const found = await call<{ _id: string; name: string; dynamic?: boolean }[]>(apiKey, `/contacts/lists?search=${encodeURIComponent(name)}`);
  if (!found.ok) return found;
  const existing = (Array.isArray(found.data) ? found.data : []).find((l) => l.name === name && !l.dynamic);
  if (existing) return { ok: true, data: { listId: existing._id } };
  const created = await call<{ list?: { id?: string } }>(apiKey, "/contacts/lists", { method: "POST", body: JSON.stringify({ name }) });
  if (!created.ok) return created;
  const id = created.data?.list?.id;
  return id ? { ok: true, data: { listId: id } } : { ok: false, status: 0, error: "Lemlist no devolvió el id de la lista" };
}

export async function addContactsToList(apiKey: string, listId: string, contactIds: string[]): Promise<Result<unknown>> {
  return call(apiKey, `/contacts/lists/${encodeURIComponent(listId)}/entities`, {
    method: "POST",
    body: JSON.stringify({ contactIds }),
  });
}

// Crea o actualiza el contacto (upsert por LinkedIn / email) → ctc_xxx
export async function upsertLemlistContact(
  apiKey: string,
  c: Record<string, string | null | undefined>,
  updateStrategy: "fillEmptyOnly" | "overwriteIgnoreEmpty" = "fillEmptyOnly"
): Promise<Result<{ contactId: string; warnings: unknown[] }>> {
  const body = Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "string" && v.trim()));
  const r = await call<{ data?: { _id?: string }; warnings?: unknown[] }>(apiKey, `/contacts?updateStrategy=${updateStrategy}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  const id = r.data?.data?._id;
  return id ? { ok: true, data: { contactId: id, warnings: r.data?.warnings ?? [] } } : { ok: false, status: 0, error: "Lemlist no devolvió el id del contacto" };
}

// Pide email + teléfono de una persona (asíncrono, gasta créditos del cliente)
export async function startLemlistEnrichment(
  apiKey: string,
  p: { linkedinUrl?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null; companyDomain?: string | null; jobTitle?: string | null }
): Promise<Result<{ enrichId: string }>> {
  const qs = new URLSearchParams({ findEmail: "true", verifyEmail: "true", findPhone: "true" });
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
  const r = await call<{ id?: string; _id?: string }>(apiKey, `/enrich?${qs.toString()}`, { method: "POST" });
  if (!r.ok) return r;
  const id = r.data?.id ?? r.data?._id;
  return id ? { ok: true, data: { enrichId: id } } : { ok: false, status: 0, error: "Lemlist no devolvió el id del enriquecimiento" };
}

export async function getLemlistEnrichment(apiKey: string, enrichId: string): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>(apiKey, `/enrich/${encodeURIComponent(enrichId)}`);
}
