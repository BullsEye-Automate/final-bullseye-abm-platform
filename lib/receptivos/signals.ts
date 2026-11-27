import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { corporateDomain, linkedinSlug } from "@/lib/baseContactos/sync";

// Contactos receptivos (pedido de BullsEye, reunión de líderes 26-nov-2026):
// personas que en los últimos 12 meses mostraron disposición a conversar con
// BullsEye por CUALQUIER cliente. Señales (acordadas con Adolfo):
//   · reunión realizada (planilla de reuniones)        5 pts
//   · reunión agendada aunque no se presentara         3 pts
//   · respuesta de Lemlist «interesado»                4 pts  · «tibio» 2 · «referido» 1,5
//   · conversó por teléfono en Allo (Base de contactos) 2 pts
// Más reciente = vale más (≤ 3 meses ×1, ≤ 6 ×0,75, ≤ 12 ×0,5).
// La lista se calcula una vez al día y queda en allo_response_cache (solo servidor:
// trae correo y celular para poder cargar el contacto; la API nunca los devuelve).

export const WINDOW_DAYS = 365;
const BASE_KEY = "receptivos:base:v1";

export type SignalKind = "reunion_realizada" | "reunion_agendada" | "lemlist_interesado" | "lemlist_tibio" | "lemlist_referido" | "conversacion_allo";
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  reunion_realizada: "Tuvo reunión",
  reunion_agendada: "Agendó reunión",
  lemlist_interesado: "Respondió con interés",
  lemlist_tibio: "Pidió contacto más adelante",
  lemlist_referido: "Refirió a otra persona",
  conversacion_allo: "Conversó por teléfono",
};
const WEIGHT: Record<SignalKind, number> = { reunion_realizada: 5, reunion_agendada: 3, lemlist_interesado: 4, lemlist_tibio: 2, lemlist_referido: 1.5, conversacion_allo: 2 };

export type Signal = { k: SignalKind; client: string | null; clientName: string | null; d: string };
export type ReceptivePerson = {
  key: string;
  name: string | null; title: string | null; company: string | null; domain: string | null;
  country: string | null; industry: string | null; linkedin: string | null;
  email: string | null; mobile: string | null;          // solo servidor
  baseClients: string[];                                  // «Cliente BullsEye» en HubSpot
  signals: Signal[];
  score: number;
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cleanEmail = (e: string | null | undefined) => { const s = (e ?? "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null; };
function recency(d: string) {
  const days = (Date.now() - new Date(d).getTime()) / 86400_000;
  return days <= 90 ? 1 : days <= 180 ? 0.75 : 0.5;
}

type BaseRow = { person_key: string; name: string | null; title: string | null; company: string | null; company_domain: string | null; country: string | null; linkedin: string | null; email: string | null; emails: string[]; mobiles: string[]; clients: string[]; phone_quality: Record<string, { st?: string; last?: string }> | null; left_company: unknown };

async function baseByEmails(emails: string[]): Promise<Map<string, BaseRow>> {
  const out = new Map<string, BaseRow>();
  const db = supabaseAdmin();
  for (let i = 0; i < emails.length; i += 150) {
    const { data } = await db.from("contact_base")
      .select("person_key, name, title, company, company_domain, country, linkedin, email, emails, mobiles, clients, phone_quality, left_company")
      .overlaps("emails", emails.slice(i, i + 150));
    for (const r of (data ?? []) as BaseRow[]) for (const e of r.emails) out.set(e, r);
  }
  return out;
}

export async function buildReceptive(): Promise<ReceptivePerson[]> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const { data: cl } = await db.from("clients").select("id, name");
  const cname = new Map(((cl ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const people = new Map<string, ReceptivePerson>();
  const get = (key: string, seed: Partial<ReceptivePerson>) => {
    let p = people.get(key);
    if (!p) { p = { key, name: null, title: null, company: null, domain: null, country: null, industry: null, linkedin: null, email: null, mobile: null, baseClients: [], signals: [], score: 0 }; people.set(key, p); }
    for (const [k, v] of Object.entries(seed)) if (v && !(p as Record<string, unknown>)[k]) (p as Record<string, unknown>)[k] = v;
    return p;
  };
  const personKey = (email: string | null, name: string | null, company: string | null) =>
    email ? `em:${email}` : name && company ? `nm:${norm(name)}|${norm(company)}` : null;

  // 1) Reuniones de la planilla (cliente_nombre solo si existe la columna:
  // migración 20261030_meetings_cliente_nombre.sql, aún no ejecutada en producción)
  const withCli = !(await db.from("meetings").select("cliente_nombre").limit(1)).error;
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db.from("meetings")
      .select("client_id, " + (withCli ? "cliente_nombre, " : "") + "empresa, contacto_nombre, contacto_cargo, correo, telefono, pais, industria, realizado, fecha_reunion, fecha_agendamiento")
      .or(`fecha_reunion.gte.${since},fecha_agendamiento.gte.${since}`).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const m of (data ?? []) as unknown as Record<string, string | null>[]) {
      const email = cleanEmail(m.correo);
      const key = personKey(email, m.contacto_nombre, m.empresa);
      if (!key) continue;
      const p = get(key, { name: m.contacto_nombre, title: m.contacto_cargo, company: m.empresa, domain: corporateDomain(email), country: m.pais, industry: m.industria, email });
      const done = m.realizado === "Si";
      p.signals.push({ k: done ? "reunion_realizada" : "reunion_agendada", client: m.client_id, clientName: m.cliente_nombre || (m.client_id ? cname.get(m.client_id) ?? null : null), d: (done ? m.fecha_reunion : m.fecha_agendamiento ?? m.fecha_reunion) ?? since });
    }
    if (!data || data.length < 1000) break;
  }

  // 2) Respuestas positivas de Lemlist
  const { data: replies } = await db.from("lemlist_replies")
    .select("client_id, client_name, lead_email, lead_name, company_name, category, replied_at, created_at")
    .in("category", ["interesado", "tibio", "referido"]).gte("created_at", since).limit(20_000);
  for (const r of (replies ?? []) as Record<string, string | null>[]) {
    const email = cleanEmail(r.lead_email);
    const key = personKey(email, r.lead_name, r.company_name);
    if (!key) continue;
    const p = get(key, { name: r.lead_name, company: r.company_name, domain: corporateDomain(email), email });
    p.signals.push({ k: `lemlist_${r.category}` as SignalKind, client: r.client_id, clientName: r.client_name, d: r.replied_at ?? r.created_at ?? since });
  }

  // 3) Conversaciones por teléfono (calidad de la Base de contactos: celular verificado)
  for (let from = 0; from < 2_000_000; from += 1000) {
    const { data, error } = await db.from("contact_base")
      .select("person_key, name, title, company, company_domain, country, linkedin, email, emails, mobiles, clients, phone_quality, left_company")
      .neq("phone_quality", "{}").order("person_key").range(from, from + 999);
    if (error) break; // sin la migración de calidad no hay esta señal
    for (const r of (data ?? []) as BaseRow[]) {
      const ok = Object.entries(r.phone_quality ?? {}).find(([, q]) => q.st === "ok" && q.last && q.last.slice(0, 10) >= since);
      if (!ok) continue;
      const email = r.email ?? r.emails[0] ?? null;
      const key = email ? `em:${email}` : r.person_key;
      const p = get(key, { name: r.name, title: r.title, company: r.company, domain: r.company_domain, country: r.country, linkedin: r.linkedin, email, mobile: ok[0] });
      p.signals.push({ k: "conversacion_allo", client: null, clientName: null, d: ok[1].last! });
    }
    if (!data || data.length < 1000) break;
  }

  // Completar con la Base de contactos (cargo, LinkedIn, celular) y sacar a quien dejó la empresa
  const emails = Array.from(people.values()).map((p) => p.email).filter((e): e is string => !!e);
  const base = await baseByEmails(emails).catch(() => new Map<string, BaseRow>());
  const out: ReceptivePerson[] = [];
  for (const p of Array.from(people.values())) {
    const b = p.email ? base.get(p.email) : undefined;
    if (b?.left_company) continue;
    if (b) {
      p.title = p.title || b.title; p.company = p.company || b.company; p.domain = p.domain || b.company_domain;
      p.country = p.country || b.country; p.linkedin = p.linkedin || b.linkedin; p.name = p.name || b.name;
      p.mobile = p.mobile || b.mobiles.find((m) => b.phone_quality?.[m]?.st !== "malo") || null;
      p.baseClients = b.clients ?? [];
    }
    if (p.linkedin && !linkedinSlug(p.linkedin)) p.linkedin = null;
    p.score = Math.round(p.signals.reduce((s, x) => s + WEIGHT[x.k] * recency(x.d), 0) * 10) / 10;
    p.signals.sort((a, b2) => b2.d.localeCompare(a.d));
    out.push(p);
  }
  return out.sort((a, b2) => b2.score - a.score);
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

export async function getReceptive(fresh = false): Promise<ReceptivePerson[]> {
  const key = `${BASE_KEY}:${today()}`;
  if (!fresh) { const c = await readMonthCache<ReceptivePerson[]>(key); if (c) return c; }
  const list = await buildReceptive();
  await writeMonthCache(key, list, 26 * 3600_000);
  return list;
}
