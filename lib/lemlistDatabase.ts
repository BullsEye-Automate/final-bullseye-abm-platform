import type { SupabaseClient } from "@supabase/supabase-js";

// Base de datos B2B de Lemlist, consultada con la API key PROPIA de cada
// cliente (client_configs.lemlist_api_key). A diferencia de getLemlistApiKey(),
// acá NO se cae a la key global de BullsEye: lo acordado es que las búsquedas
// y las empresas queden en la cuenta del cliente.
//
// Endpoints:
//  - GET  /database/filters?usage=api&mode=companies   (confirmado)
//  - POST /database/people  { filters, search, page, size }   (confirmado)
//  - POST /database/companies  mismo body   (⚠️ inferido por simetría con
//    /database/people — se valida en producción con el diagnóstico de
//    /solicitudes-clientes; si falla, la fuente Lemlist muestra el error)

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
    .filter((f) => f.filterId && (!f.mode || f.mode.includes("companies")));
  return { ok: true, data: defs };
}

// Empresa normalizada para el portal. `raw` guarda los campos útiles tal
// como llegan (los nombres exactos de Lemlist se confirman en producción).
export type LemlistCompany = {
  id: string;
  name: string;
  domain: string | null;
  linkedin_url: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
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

function normalizeCompany(o: Record<string, unknown>): LemlistCompany | null {
  const name = pickStr(o, "name", "companyName", "company_name");
  if (!name) return null;
  const domainRaw = pickStr(o, "domain", "companyDomain", "website", "websiteUrl", "url");
  const domain = domainRaw
    ? domainRaw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || null
    : null;
  const loc = [pickStr(o, "city", "hqCity"), pickStr(o, "country", "hqCountry", "location")].filter(Boolean).join(", ");
  return {
    id: pickStr(o, "_id", "id", "companyId") ?? domain ?? name,
    name,
    domain,
    linkedin_url: pickStr(o, "linkedinUrl", "linkedin_url", "linkedin"),
    industry: pickStr(o, "industry", "industries", "sector"),
    size: pickStr(o, "size", "headcount", "employeeCount", "employees", "staffCount", "sizeRange"),
    location: loc || null,
    description: pickStr(o, "description", "shortDescription", "tagline"),
  };
}

export async function searchLemlistCompanies(
  apiKey: string,
  body: { filters: LemlistFilter[]; search?: string; page: number; size: number }
): Promise<Result<{ companies: LemlistCompany[]; total: number | null; rawKeys: string[] }>> {
  const payload: Record<string, unknown> = {
    filters: body.filters.filter((f) => f.in?.length || f.out?.length),
    page: body.page,
    size: Math.min(Math.max(body.size, 1), 100),
  };
  if (body.search?.trim()) payload.search = body.search.trim();

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
    },
  };
}
