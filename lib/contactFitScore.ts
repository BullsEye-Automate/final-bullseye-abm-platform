import type { SupabaseClient } from "@supabase/supabase-js";
import { extractField } from "./icp-form";

export type BuyerPersonaRoles = {
  decisionMakers: string[];
  influencers: string[];
  avoid: string[];
};

function splitRoles(text: string): string[] {
  return text
    .split(/[,\n]/)
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

function matchesAny(jobTitle: string, roles: string[]): boolean {
  const nJob = normalize(jobTitle);
  if (!nJob) return false;
  return roles.some((r) => {
    const nRole = normalize(r);
    if (!nRole) return false;
    return nJob.includes(nRole) || nRole.includes(nJob);
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
