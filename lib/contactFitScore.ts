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

// Trae los cargos objetivo (decisores/influenciadores/a evitar) del ICP del
// cliente activo, uniendo todas sus industrias (sistema de ICP por industria).
// Si el cliente no tiene industrias configuradas, devuelve listas vacías —
// computeContactFitScore cae a un score neutro en ese caso.
export async function getClientBuyerPersonaRoles(
  db: SupabaseClient,
  clientId: string
): Promise<BuyerPersonaRoles> {
  const { data: industries } = await db
    .from("icp_industries")
    .select("id")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true });

  if (!industries?.length) return { decisionMakers: [], influencers: [], avoid: [] };

  const { data: sections } = await db
    .from("icp_industry_sections")
    .select("industry_id, content")
    .in("industry_id", industries.map((i) => i.id))
    .eq("section_key", "buyer_persona");

  const decisionMakers = new Set<string>();
  const influencers = new Set<string>();
  const avoid = new Set<string>();

  for (const s of sections ?? []) {
    for (const r of splitRoles(extractField(s.content ?? "", "Cargos decisores (quien aprueba)"))) decisionMakers.add(r);
    for (const r of splitRoles(extractField(s.content ?? "", "Cargos influenciadores (quien recomienda)"))) influencers.add(r);
    for (const r of splitRoles(extractField(s.content ?? "", "Cargos a evitar"))) avoid.add(r);
  }

  return {
    decisionMakers: Array.from(decisionMakers),
    influencers: Array.from(influencers),
    avoid: Array.from(avoid),
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
export function computeContactFitScore(input: { jobTitle: string | null; roles: BuyerPersonaRoles }): number {
  const jobTitle = input.jobTitle ?? "";
  if (!jobTitle.trim()) return 5;
  if (matchesAny(jobTitle, input.roles.avoid)) return 2;
  if (matchesAny(jobTitle, input.roles.decisionMakers)) return 9;
  if (matchesAny(jobTitle, input.roles.influencers)) return 6;
  return 5;
}
