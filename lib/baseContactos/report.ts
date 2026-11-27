import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { linkedinSlug, listSources, MIGRATION_HINT, readState, sourceTotals } from "./sync";
import { maskPhone } from "./phones";
import { qualityColumnsReady, readQualityState } from "./quality";

// Diagnóstico de la Base de contactos: universo que ya tenemos y ahorro de
// créditos de Lemlist (Centro de prospección → Base de contactos).

export const CREDITS_PHONE = 20;   // créditos por teléfono revelado (Lemlist)
export const CREDITS_EMAIL = 5;    // créditos por correo
export const USD_PER_CREDIT = 0.009;
const SUMMARY_KEY = "base_contactos:summary:v2";
const BACK_DAYS = 180;

type QMap = Record<string, { st?: string; why?: string }>;
type Row = { person_key: string; country: string | null; email: string | null; linkedin: string | null; company_domain: string | null; mobiles: string[]; mobiles_maybe: string[]; clients: string[]; sources: { s: string; id: string; c: string | null; m: boolean; lp: boolean }[]; phone_quality?: QMap | null; email_quality?: QMap | null; left_company?: { why: string } | null };
type Count = { label: string; total: number; mobile: number; maybe: number; email: number };

export type BaseSummary = {
  at: string;
  total: number; mobile: number; maybe: number; email: number; linkedin: number; multiSource: number; mobileOrEmail: number;
  byCountry: Count[]; bySource: Count[]; byClient: Count[];
  back: {
    days: number;
    hubspotDuplicates: number;   // reveló teléfono Lemlist y la misma persona ya tenía celular en otro registro anterior
    portalEnrich: number;        // Contactos IA pidió teléfono y la persona ya estaba con celular
    portalEnrichTotal: number;
  };
  forward: { companies: number; companiesWithPeople: number; people: number; byClient: { client: string; companies: number; people: number }[] };
  sync: { passStartedAt: string | null; passFinishedAt: string | null; sources: { key: string; label: string; count: number; done: boolean; error?: string | null }[] };
  costs: { phone: number; email: number; usdPerCredit: number };
  quality: {
    ready: boolean; phonesOk: number; phonesSuspect: number; phonesBad: number; emailsBad: number; left: number;
    peopleUsable: number;               // con celular que no está malo
    state: { alloDay: string | null; backfillDone: boolean; at?: string; error?: string | null } | null;
  };
};

function bump(map: Map<string, Count>, label: string, r: Row) {
  const c = map.get(label) ?? { label, total: 0, mobile: 0, maybe: 0, email: 0 };
  c.total++;
  if (r.mobiles.length) c.mobile++;
  else if (r.mobiles_maybe.length) c.maybe++;
  if (r.email) c.email++;
  map.set(label, c);
}
const sorted = (m: Map<string, Count>) => Array.from(m.values()).sort((a, b) => b.total - a.total);

export async function buildSummary(): Promise<BaseSummary> {
  const db = supabaseAdmin();
  const [sources, state] = await Promise.all([listSources(), readState()]);
  const srcLabel = new Map(sources.map((s) => [s.key, s.label]));
  const byCountry = new Map<string, Count>(), bySource = new Map<string, Count>(), byClient = new Map<string, Count>();
  const domainPeople = new Map<string, number>();
  let total = 0, mobile = 0, maybe = 0, email = 0, linkedin = 0, multi = 0, mobileOrEmail = 0, dup = 0;
  const withQ = await qualityColumnsReady();
  let qOk = 0, qSus = 0, qBad = 0, eBad = 0, left = 0, usable = 0;
  const since = Date.now() - BACK_DAYS * 86400_000;

  for (let from = 0; from < 2_000_000; from += 1000) {
    const { data, error } = await db.from("contact_base")
      .select("person_key, country, email, linkedin, company_domain, mobiles, mobiles_maybe, clients, sources" + (withQ ? ", phone_quality, email_quality, left_company" : ""))
      .order("person_key").range(from, from + 999);
    if (error) throw new Error(/does not exist|relation|schema cache|could not find the table/i.test(error.message) ? MIGRATION_HINT : error.message);
    for (const r of (data ?? []) as unknown as Row[]) {
      total++;
      if (withQ) {
        const pq = r.phone_quality ?? {};
        for (const v of Object.values(pq)) { if (v.st === "ok") qOk++; else if (v.st === "sospechoso") qSus++; else if (v.st === "malo") qBad++; }
        eBad += Object.values(r.email_quality ?? {}).filter((v) => v.st === "malo").length;
        if (r.left_company) left++;
        if (r.mobiles.some((m) => pq[m]?.st !== "malo")) usable++;
      }
      if (r.mobiles.length) mobile++; else if (r.mobiles_maybe.length) maybe++;
      if (r.email) email++;
      if (r.linkedin) linkedin++;
      if (r.mobiles.length || r.email) mobileOrEmail++;
      if (r.sources.length > 1) multi++;
      bump(byCountry, r.country ?? "Sin país", r);
      for (const s of Array.from(new Set(r.sources.map((x) => x.s)))) bump(bySource, srcLabel.get(s) ?? s, r);
      for (const c of r.clients.length ? r.clients : ["Sin cliente asignado"]) bump(byClient, c, r);
      if (r.company_domain && r.mobiles.length) domainPeople.set(r.company_domain, (domainPeople.get(r.company_domain) ?? 0) + 1);
      // Duplicado pagado: un registro reciente con teléfono de Lemlist y otro anterior (de 1 día antes) que ya tenía celular
      const recentLp = r.sources.filter((x) => x.lp && x.c && new Date(x.c).getTime() >= since);
      if (recentLp.some((n) => r.sources.some((o) => o !== n && o.m && o.c && new Date(o.c).getTime() < new Date(n.c!).getTime() - 86400_000))) dup++;
    }
    if (!data || data.length < 1000) break;
  }

  // Contactos IA: teléfonos pedidos a Lemlist de personas que ya teníamos con celular
  const sinceIso = new Date(since).toISOString();
  const { data: enr } = await db.from("wishlist_contacts").select("linkedin_url, reviewed_at").not("enrich_id", "is", null).gte("reviewed_at", sinceIso).limit(20_000);
  const enrRows = ((enr ?? []) as { linkedin_url: string | null; reviewed_at: string | null }[]);
  let portalEnrich = 0;
  const keyed = enrRows.map((e) => ({ key: linkedinSlug(e.linkedin_url), at: e.reviewed_at })).filter((e): e is { key: string; at: string } => !!e.key && !!e.at);
  for (let i = 0; i < keyed.length; i += 300) {
    const part = keyed.slice(i, i + 300);
    const { data } = await db.from("contact_base").select("person_key, sources").in("person_key", part.map((p) => `li:${p.key}`));
    const map = new Map(((data ?? []) as Pick<Row, "person_key" | "sources">[]).map((r) => [r.person_key, r.sources]));
    for (const p of part) {
      const srcs = map.get(`li:${p.key}`) ?? [];
      if (srcs.some((o) => o.m && o.c && new Date(o.c).getTime() < new Date(p.at).getTime() - 86400_000)) portalEnrich++;
    }
  }

  // Hacia adelante: empresas aprobadas que esperan búsqueda de contactos
  const { data: wl } = await db.from("client_wishlist").select("client_id, domain").in("status", ["new", "in_lemlist", "in_progress"]).eq("contacts_status", "pending").limit(20_000);
  const { data: cl } = await db.from("clients").select("id, name");
  const cname = new Map(((cl ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const fw = new Map<string, { client: string; companies: number; people: number }>();
  let companies = 0, withPeople = 0, people = 0;
  for (const w of (wl ?? []) as { client_id: string; domain: string | null }[]) {
    companies++;
    const d = (w.domain ?? "").toLowerCase().replace(/^www\./, "");
    const n = d ? domainPeople.get(d) ?? 0 : 0;
    const k = cname.get(w.client_id) ?? w.client_id;
    const f = fw.get(k) ?? { client: k, companies: 0, people: 0 };
    f.companies++;
    if (n) { withPeople++; people += n; f.people += n; }
    fw.set(k, f);
  }

  const summary: BaseSummary = {
    at: new Date().toISOString(),
    total, mobile, maybe, email, linkedin, multiSource: multi, mobileOrEmail,
    byCountry: sorted(byCountry), bySource: sorted(bySource), byClient: sorted(byClient).slice(0, 40),
    back: { days: BACK_DAYS, hubspotDuplicates: dup, portalEnrich, portalEnrichTotal: enrRows.length },
    forward: { companies, companiesWithPeople: withPeople, people, byClient: Array.from(fw.values()).sort((a, b) => b.people - a.people) },
    sync: {
      passStartedAt: state.passStartedAt, passFinishedAt: state.passFinishedAt,
      sources: sources.map((s) => ({ key: s.key, label: s.label, ...sourceTotals(state, s.key) })),
    },
    costs: { phone: CREDITS_PHONE, email: CREDITS_EMAIL, usdPerCredit: USD_PER_CREDIT },
    quality: {
      ready: withQ, phonesOk: qOk, phonesSuspect: qSus, phonesBad: qBad, emailsBad: eBad, left, peopleUsable: withQ ? usable : mobile,
      state: withQ ? await readQualityState().then((q) => ({ alloDay: q.alloDay, backfillDone: q.backfillDone, at: q.at, error: q.error ?? null })) : null,
    },
  };
  await writeMonthCache(SUMMARY_KEY, summary, 3 * 86400_000);
  return summary;
}

export async function getSummary(fresh = false): Promise<BaseSummary> {
  if (!fresh) {
    const c = await readMonthCache<BaseSummary>(SUMMARY_KEY);
    if (c) return c;
  }
  return buildSummary();
}

// Buscador: persona o empresa (sin mostrar el número completo)
export async function searchBase(q: string) {
  const s = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (s.length < 3) return [];
  const { data, error } = await supabaseAdmin().from("contact_base")
    .select("name, title, company, company_domain, country, linkedin, email, mobiles, mobiles_maybe, clients, sources" + ((await qualityColumnsReady()) ? ", phone_quality, email_quality, left_company" : ""))
    .or(`name.ilike.%${s}%,company.ilike.%${s}%,company_domain.ilike.%${s}%,linkedin.ilike.%${s}%`)
    .limit(50);
  if (error) throw new Error(/does not exist|relation|schema cache|could not find the table/i.test(error.message) ? MIGRATION_HINT : error.message);
  const sources = await listSources();
  const label = new Map(sources.map((x) => [x.key, x.label.replace(/^HubSpot de /, "")]));
  const tag = (q: QMap | null | undefined, k: string) => { const st = q?.[k]?.st; return st === "malo" ? " (malo)" : st === "sospechoso" ? " (sospechoso)" : st === "ok" ? " (verificado)" : ""; };
  return ((data ?? []) as unknown as (Row & { name: string | null; title: string | null; company: string | null })[]).map((r) => ({
    name: r.name, title: r.title, company: r.company, domain: r.company_domain, country: r.country, linkedin: r.linkedin,
    hasEmail: !!r.email, emailBad: !!(r.email && r.email_quality?.[r.email]?.st === "malo"), left: r.left_company?.why ?? null,
    mobiles: r.mobiles.map((m) => maskPhone(m) + tag(r.phone_quality, m)), maybe: r.mobiles_maybe.map((m) => maskPhone(m) + tag(r.phone_quality, m)), clients: r.clients,
    sources: Array.from(new Set(r.sources.map((x) => label.get(x.s) ?? x.s))),
  }));
}
