import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIcpText, markRecommendation } from "@/lib/wishlist";
import { icpHash } from "@/lib/wishlistFit";
import { runRecommendationRound, RecoInputError } from "@/lib/wishlistRecommendations";
import { encodeRef } from "@/lib/unifiedSearch";
import { peopleFor, type PeopleSummary } from "@/lib/acti/search";
import { currentMonth } from "@/lib/acti/quota";

// ACTI · Recomendadas por IA. Usa el motor de recomendaciones existente
// (runRecommendationRound → client_recommendations) con el ICP del socio. Los
// socios no tienen Lemlist propio, así que el motor busca en la base de
// empresas de BullsEye (decisión: "inicialmente de nuestra base").
//
// Orden (decisión de BullsEye 27-nov-2026): fit → empresas con contactos con
// celular en nuestra Base de contactos (gestión más barata) → menor demanda
// entre socios. El fit se compara por tramos de 10 puntos para que el celular
// y la demanda desempaten entre empresas de fit parecido.

export type RecoCard = {
  id: string;
  ref: string;
  name: string;
  domain: string | null;
  facts: { label: string; value: string }[];
  fit: { score: number; reason: string };
  people: PeopleSummary;
  demand: number;         // otros socios que la pidieron este mes
  saved: boolean;
};

export function sortRecos<T extends { fit: { score: number }; people: { mobiles: number }; demand: number }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    Math.floor(b.fit.score / 10) - Math.floor(a.fit.score / 10) ||
    Number(b.people.mobiles > 0) - Number(a.people.mobiles > 0) ||
    a.demand - b.demand ||
    b.fit.score - a.fit.score ||
    b.people.mobiles - a.people.mobiles
  );
}

// Demanda del mes por dominio: cuántos OTROS socios pidieron la empresa
export async function demandByDomain(db: SupabaseClient, clientId: string, domains: (string | null)[]) {
  const list = [...new Set(domains.filter((d): d is string => !!d))];
  const out = new Map<string, { others: number; paidOthers: number }>();
  if (!list.length) return out;
  const { data } = await db
    .from("acti_requests")
    .select("client_id, domain, priority")
    .eq("month", currentMonth())
    .neq("status", "cancelada")
    .in("domain", list);
  for (const r of (data ?? []) as { client_id: string; domain: string; priority: number }[]) {
    if (r.client_id === clientId) continue;
    const cur = out.get(r.domain) ?? { others: 0, paidOthers: 0 };
    cur.others++;
    if (r.priority > 0) cur.paidOthers++;
    out.set(r.domain, cur);
  }
  return out;
}

export async function listRecommendations(db: SupabaseClient, clientId: string): Promise<{ cards: RecoCard[]; icpMissing: boolean }> {
  const icpText = await getClientIcpText(db, clientId);
  if (!icpText.trim()) return { cards: [], icpMissing: true };
  const [{ data }, { data: saved }] = await Promise.all([
    db
      .from("client_recommendations")
      .select("id, source, source_ref, company_name, domain, facts, fit_score, fit_reason")
      .eq("client_id", clientId)
      .eq("status", "pending")
      .eq("icp_hash", icpHash(icpText))
      .order("fit_score", { ascending: false })
      .limit(300),
    db.from("acti_saved_companies").select("hs_id").eq("client_id", clientId),
  ]);
  const rows = (data ?? []) as { id: string; source: "hubspot" | "lemlist"; source_ref: string; company_name: string; domain: string | null; facts: { label: string; value: string }[]; fit_score: number; fit_reason: string }[];
  const savedSet = new Set(((saved ?? []) as { hs_id: string }[]).map((s) => s.hs_id));
  const [people, demand] = await Promise.all([
    peopleFor(db, rows.map((r) => r.domain)),
    demandByDomain(db, clientId, rows.map((r) => r.domain)),
  ]);
  const cards = rows.map((r) => ({
    id: r.id,
    ref: encodeRef(r.source, r.source_ref),
    name: r.company_name,
    domain: r.domain,
    // Las notas internas de la revisión (claves "__…") no viajan al socio
    facts: (r.facts ?? []).filter((f) => !f.label.startsWith("__")).slice(0, 6),
    fit: { score: r.fit_score, reason: r.fit_reason },
    people: (r.domain && people.get(r.domain)) || { contacts: 0, mobiles: 0, areas: [], levels: [] },
    demand: (r.domain && demand.get(r.domain)?.others) || 0,
    saved: r.source === "hubspot" && savedSet.has(r.source_ref),
  }));
  return { cards: sortRecos(cards), icpMissing: false };
}

export async function generateRecommendations(db: SupabaseClient, clientId: string) {
  try {
    const r = await runRecommendationRound(db, clientId);
    return { ok: true as const, found: r.cards.length, exhausted: !!r.exhausted };
  } catch (e) {
    if (e instanceof RecoInputError) return { ok: false as const, error: e.message };
    throw e;
  }
}

// "No me interesa" (con motivo): sale de las recomendaciones y de las
// búsquedas (client_omitted_companies, igual que "Omitir" del portal). El
// motivo queda guardado para que el equipo y el motor lo usen.
export const NOT_INTERESTED_REASONS: Record<string, string> = {
  ya_cliente: "Ya es mi cliente",
  competencia: "Es competencia o partner",
  tamano: "No calza en tamaño",
  industria: "No es una industria que me interese",
  pais: "No opero en ese país",
  otro: "Otro motivo",
};

export async function notInterested(
  db: SupabaseClient,
  clientId: string,
  recoId: string,
  motivo: string,
  nota: string | null,
  by: { email: string; portalUserId: string }
) {
  const { data: rec } = await db
    .from("client_recommendations")
    .select("source, source_ref, company_name, domain, linkedin_url, facts, fit_score, fit_reason")
    .eq("id", recoId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!rec) return { ok: false as const, error: "Empresa no encontrada" };
  const label = NOT_INTERESTED_REASONS[motivo] ?? NOT_INTERESTED_REASONS.otro;
  const { error } = await db.from("client_omitted_companies").insert({
    client_id: clientId,
    company_name: rec.company_name,
    domain: rec.domain,
    linkedin_url: rec.linkedin_url,
    source: rec.source,
    source_ref: rec.source_ref,
    fit_score: rec.fit_score,
    fit_reason: rec.fit_reason,
    snapshot: { facts: rec.facts ?? [], acti: true, motivo_socio: motivo, motivo_socio_label: label, nota: nota?.slice(0, 300) ?? null },
    omitted_by: by.portalUserId,
    omitted_by_email: by.email,
  });
  if (error && error.code !== "23505") return { ok: false as const, error: error.message };
  await markRecommendation(db, clientId, rec.source, rec.source_ref, "omitted");
  return { ok: true as const };
}
