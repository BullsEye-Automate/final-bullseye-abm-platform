import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyTitle } from "@/lib/radarAbm/derive";
import { loadRadarConfig } from "@/lib/radarAbm/server/store";
import { DEFAULT_TITLE_RULES } from "@/lib/radarAbm/dictionaries";

// ACTI · perfiles disponibles por empresa (tabla acti_company_people).
// Lee la Base de contactos (contact_base) y guarda por dominio SOLO conteos y
// tipos de cargo (área / nivel con la misma tabla de cargos de Pulso ABM).
// Nunca nombres, correos ni teléfonos: es lo que puede ver el socio.

type Agg = { contacts: number; mobiles: number; areas: Map<string, number>; levels: Map<string, number>; titles: Set<string> };

const PAGE = 1000;
const MAX_TITLES = 40;
// Dominios genéricos que no identifican una empresa
const GENERIC = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "live.com", "icloud.com"]);

export const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);

export function summarizePeople(
  rows: { company_domain: string | null; title: string | null; mobiles: string[] | null }[],
  rules: Parameters<typeof classifyTitle>[1],
  into = new Map<string, Agg>()
): Map<string, Agg> {
  for (const r of rows) {
    const d = r.company_domain?.trim().toLowerCase();
    if (!d || GENERIC.has(d)) continue;
    let a = into.get(d);
    if (!a) into.set(d, (a = { contacts: 0, mobiles: 0, areas: new Map(), levels: new Map(), titles: new Set() }));
    a.contacts++;
    if (r.mobiles?.length) a.mobiles++;
    if (r.title?.trim()) {
      const { area, sen } = classifyTitle(r.title, rules);
      if (area !== "Sin área") a.areas.set(area, (a.areas.get(area) ?? 0) + 1);
      if (sen !== "Sin seniority") a.levels.set(sen, (a.levels.get(sen) ?? 0) + 1);
      if (a.titles.size < MAX_TITLES) a.titles.add(normTitle(r.title));
    }
  }
  return into;
}

const byCount = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);

export async function refreshCompanyPeople(db: SupabaseClient, deadline = Date.now() + 240_000) {
  const cfg = await loadRadarConfig().catch(() => null);
  const rules = cfg?.titleRules?.length ? cfg.titleRules : DEFAULT_TITLE_RULES;
  const startedAt = new Date().toISOString();
  const agg = new Map<string, Agg>();
  let after = "";
  let read = 0;
  for (;;) {
    if (Date.now() > deadline) return { done: false, read, domains: agg.size, reason: "tiempo" };
    const { data, error } = await db
      .from("contact_base")
      .select("person_key, company_domain, title, mobiles")
      .not("company_domain", "is", null)
      .gt("person_key", after)
      .order("person_key", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { person_key: string; company_domain: string | null; title: string | null; mobiles: string[] | null }[];
    if (!rows.length) break;
    summarizePeople(rows, rules, agg);
    read += rows.length;
    after = rows[rows.length - 1].person_key;
    if (rows.length < PAGE) break;
  }

  const out = [...agg.entries()].map(([domain, a]) => ({
    domain,
    contacts: a.contacts,
    mobiles: a.mobiles,
    areas: byCount(a.areas),
    levels: byCount(a.levels),
    titles: [...a.titles],
    updated_at: startedAt,
  }));
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await db.from("acti_company_people").upsert(out.slice(i, i + 500), { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }
  // Dominios que ya no tienen personas en la base
  await db.from("acti_company_people").delete().lt("updated_at", startedAt);
  return { done: true, read, domains: out.length };
}
