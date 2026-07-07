import type { SupabaseClient } from "@supabase/supabase-js";
import { extractField } from "./icp-form";

export type BuyerPersonaRoles = {
  decisionMakers: string[];
  influencers: string[];
  avoid: string[];
};

// Cada línea del ICP suele traer varias variantes separadas por "/", ej.
// "Director Comercial / Director de Ventas / Director de Marketing" — hay
// que partirlas en frases individuales, si no toda la línea se compara como
// un solo bloque de texto y el matching pierde precisión.
function splitRoles(text: string): string[] {
  return text
    .split(/[,\n/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Los cargos en el ICP suelen estar en español y los de LinkedIn en inglés
// (ej. "Commercial Director" vs "Director Comercial") — mismo cargo, orden
// de palabras y ortografía distintos. Sin esto, el matching por substring
// nunca los conecta. Mapea cognados comunes de roles B2B a una forma
// canónica en español para poder comparar por conjunto de palabras.
const ROLE_WORD_SYNONYMS: Record<string, string> = {
  commercial: "comercial",
  sales: "ventas",
  growth: "crecimiento",
  head: "jefe",
  chief: "jefe",
  officer: "oficial",
  president: "presidente",
  founder: "fundador",
  owner: "dueno",
  business: "negocios",
  development: "desarrollo",
  revenue: "ingresos",
  operations: "operaciones",
  executive: "ejecutivo",
  manager: "gerente",
  lead: "lider",
  regional: "regional",
};

const ROLE_STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "of", "the", "and", "y", "para", "en", "a"]);

function roleTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !ROLE_STOPWORDS.has(w))
    .map((w) => ROLE_WORD_SYNONYMS[w] ?? w);
}

function collectRoles(content: string, target: BuyerPersonaRoles) {
  for (const r of splitRoles(extractField(content, "Cargos decisores (quien aprueba)"))) target.decisionMakers.push(r);
  for (const r of splitRoles(extractField(content, "Cargos influenciadores (quien recomienda)"))) target.influencers.push(r);
  for (const r of splitRoles(extractField(content, "Cargos a evitar"))) target.avoid.push(r);
}

// Trae los cargos objetivo (decisores/influenciadores/a evitar) del ICP del
// cliente activo. Todos los clientes tienen un documento ICP general
// (client_ai_context, file_type='icp') con esta sección — es la fuente
// principal. Si además el cliente usa ICP por industria (icp_industries),
// esos cargos se suman. Si no hay nada configurado, devuelve listas vacías —
// computeContactFitScore cae a un score neutro en ese caso.
export async function getClientBuyerPersonaRoles(
  db: SupabaseClient,
  clientId: string
): Promise<BuyerPersonaRoles> {
  const raw: BuyerPersonaRoles = { decisionMakers: [], influencers: [], avoid: [] };

  const { data: icpDoc } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (icpDoc?.content) collectRoles(icpDoc.content, raw);

  const { data: industries } = await db
    .from("icp_industries")
    .select("id")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true });

  if (industries?.length) {
    const { data: sections } = await db
      .from("icp_industry_sections")
      .select("industry_id, content")
      .in("industry_id", industries.map((i) => i.id))
      .eq("section_key", "buyer_persona");
    for (const s of sections ?? []) collectRoles(s.content ?? "", raw);
  }

  return {
    decisionMakers: Array.from(new Set(raw.decisionMakers)),
    influencers: Array.from(new Set(raw.influencers)),
    avoid: Array.from(new Set(raw.avoid)),
  };
}

// Matchea por conjunto de palabras (canonicalizadas), no por substring
// literal — así "Commercial Director" (LinkedIn, inglés) matchea contra
// "Director Comercial" (ICP, español) sin importar idioma ni orden.
// Requiere que el cargo más corto de los dos esté completamente contenido
// en el más largo, para no matchear cargos solo parcialmente relacionados
// (ej. "Sales Manager" no debería matchear "Director de Ventas").
function matchesAny(jobTitle: string, roles: string[]): boolean {
  const jobTokens = new Set(roleTokens(jobTitle));
  if (jobTokens.size === 0) return false;
  return roles.some((r) => {
    const rTokens = roleTokens(r);
    if (rTokens.length === 0) return false;
    const roleSet = new Set(rTokens);
    const roleInJob = rTokens.every((t) => jobTokens.has(t));
    const jobInRole = Array.from(jobTokens).every((t) => roleSet.has(t));
    return roleInJob || jobInRole;
  });
}

// Score heurístico 1-10 por cargo, comparando el job_title del contacto contra
// los cargos decisores/influenciadores/a evitar del ICP del cliente. No requiere
// llamada a IA — es determinístico y rápido, pensado para correr en paralelo
// sobre listas grandes de contactos importados manualmente (sin scoring de Clay).
//
// companyFit (fit_signals/fit_score de la empresa, ya investigada por
// researchOneCompanyFast) limita el score hacia arriba: un cargo decisor en
// una empresa que la IA clasificó como bajo/medio fit para el ICP no debería
// salir con 9 solo porque el cargo matchea — el caso real que motivó esto es
// un CEO cuyo cargo actual es en una empresa fuera de ICP (ej. una isapre),
// aunque también figure como board member en la empresa target real.
export function computeContactFitScore(input: {
  jobTitle: string | null;
  roles: BuyerPersonaRoles;
  companyFit?: "high" | "medium" | "low" | null;
}): number {
  const jobTitle = input.jobTitle ?? "";
  let score: number;
  if (!jobTitle.trim()) score = 5;
  else if (matchesAny(jobTitle, input.roles.avoid)) score = 2;
  else if (matchesAny(jobTitle, input.roles.decisionMakers)) score = 9;
  else if (matchesAny(jobTitle, input.roles.influencers)) score = 6;
  else score = 5;

  if (input.companyFit === "low") return Math.min(score, 4);
  if (input.companyFit === "medium") return Math.min(score, 7);
  return score;
}
