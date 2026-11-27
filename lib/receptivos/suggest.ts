import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { anthropic, HAIKU_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { getClientExclusions, getClientIcpText } from "@/lib/wishlist";
import { scoreCompanies } from "@/lib/wishlistFit";
import { scoreTitlesForClient } from "@/lib/wishlistContacts";
import { normalizeDomain } from "@/lib/hubspotPool";
import { getReceptive, SIGNAL_LABEL, type ReceptivePerson, type SignalKind } from "./signals";

// Sugerencias de contactos receptivos para un cliente (Centro de prospección →
// «Contactos receptivos»). Reglas acordadas con BullsEye (27-nov-2026):
//   · el contacto debe calzar con el ICP del cliente: cargo (buyer persona, misma IA
//     y caché que Contactos IA, fit ≥ 60) y empresa (fit de empresa ≥ 60, mismo caché
//     que la wishlist); fuera de su lista de exclusión;
//   · no se sugiere a quien ya trabajamos para este mismo cliente;
//   · si conversó con nosotros por un cliente que podría ser competidor, se muestra
//     con aviso para que decida el KAM (no se oculta);
//   · se cargan vía prospección (la prospectora valida y lo pasa al HubSpot).
// Resultado por cliente cacheado por semana; las decisiones se aplican en vivo.

export const TITLE_MIN = 60;
export const COMPANY_MIN = 60;
const MAX_COMPANIES = 300;
const DECISION_PREFIX = "receptivo:";

export type Decision = { st: "cargado" | "descartado"; by: string; at: string; motivo?: string | null; hs?: string | null };
export type Suggestion = {
  key: string; name: string | null; title: string | null; company: string | null; domain: string | null;
  country: string | null; linkedin: string | null; hasMobile: boolean; hasEmail: boolean;
  score: number; titleFit: number; companyFit: number; companyReason: string;
  signals: { label: string; d: string; withOther: boolean }[];
  competitor: { client: string; reason: string } | null;
  inPortfolio: boolean;
  decision?: Decision | null;
};
export type ClientReceptivos = {
  at: string; clientId: string; clientName: string; hasIcp: boolean;
  stats: {
    receptiveTotal: number; candidates: number; excluded: number; alreadyThisClient: number;
    noTitle: number; titleFit: number; titlePartial: number; companyFit: number; final: number;
    bySignal: { label: string; n: number }[]; byCountry: { label: string; n: number }[]; withCompetitor: number; inPortfolio: number;
  };
  suggestions: Suggestion[];
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const compact = (s: string | null | undefined) => norm(s).replace(/ /g, "");
const weekKey = () => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

// ¿El contacto ya es de este cliente? (reunión / respuesta por este cliente o «Cliente BullsEye» = cliente)
function belongsTo(p: ReceptivePerson, clientId: string, clientName: string) {
  const c = compact(clientName);
  return p.signals.some((s) => s.client === clientId || (s.clientName && compact(s.clientName).startsWith(c.slice(0, 6)) && c.length >= 4))
    || p.baseClients.some((v) => { const x = compact(v); return x.length >= 4 && (x === c || x.startsWith(c) || c.startsWith(x)); });
}

// Competencia entre dos clientes de BullsEye (IA, una vez por par, 180 días)
async function competitorCheck(a: { id: string; name: string }, b: { id: string; name: string }): Promise<string | null> {
  const [x, y] = [a, b].sort((p, q) => p.id.localeCompare(q.id));
  const key = `receptivos_competencia:${x.id}:${y.id}`;
  const cached = await readMonthCache<{ comp: boolean; reason: string }>(key);
  if (cached) return cached.comp ? cached.reason : null;
  const db = supabaseAdmin();
  const [ix, iy] = await Promise.all([getClientIcpText(db, x.id), getClientIcpText(db, y.id)]);
  let comp = false, reason = "";
  try {
    const msg = await anthropic().messages.create({
      model: HAIKU_MODEL, max_tokens: 200,
      system: "Decides si dos empresas clientes de una agencia de prospección B2B compiten entre sí: venden un servicio o producto sustituto al mismo tipo de comprador. Responde solo JSON {\"compiten\": true|false, \"motivo\": \"una frase\"}.",
      messages: [{ role: "user", content: `Cliente A: ${x.name}\n${ix.slice(0, 2500)}\n\nCliente B: ${y.name}\n${iy.slice(0, 2500)}` }],
    });
    void logAiUsage({ clientId: a.id, functionName: "receptivos_competencia", model: HAIKU_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
    const raw = (msg.content.find((b2: { type: string }) => b2.type === "text") as { text: string } | undefined)?.text ?? "";
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { compiten?: boolean; motivo?: string };
    comp = !!j.compiten; reason = (j.motivo ?? "").slice(0, 200);
  } catch {
    return null; // sin respuesta no se marca ni se guarda
  }
  await writeMonthCache(key, { comp, reason }, 180 * 86400_000);
  return comp ? reason || "Ofrecen servicios parecidos" : null;
}

async function loadDecisions(clientId: string): Promise<Map<string, Decision>> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key, response").like("cache_key", `${DECISION_PREFIX}${clientId}:%`).limit(10_000);
  const out = new Map<string, Decision>();
  for (const r of (data ?? []) as { cache_key: string; response: Decision }[]) out.set(r.cache_key.slice(`${DECISION_PREFIX}${clientId}:`.length), r.response);
  return out;
}
export async function saveDecision(clientId: string, key: string, d: Decision) {
  await writeMonthCache(`${DECISION_PREFIX}${clientId}:${key}`, d, 3 * 365 * 86400_000);
}

async function compute(clientId: string): Promise<ClientReceptivos> {
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");
  const people = await getReceptive();
  const icpText = await getClientIcpText(db, clientId);
  const hasIcp = !!icpText.trim();

  // Exclusión explícita del cliente (lista de exclusión + palabras clave + exclusiones internas)
  const [{ data: excl }, { data: intEx }] = await Promise.all([
    db.from("client_exclusions").select("kind, company_name, domain, keyword").eq("client_id", clientId),
    db.from("excluded_companies").select("company_name, company_website").eq("client_id", clientId),
  ]);
  const exNames = new Set<string>(), exDomains = new Set<string>(), exKw: string[] = [];
  for (const r of (excl ?? []) as Record<string, string | null>[]) {
    if (r.kind === "keyword" && r.keyword) exKw.push(norm(r.keyword));
    else { if (r.company_name) exNames.add(norm(r.company_name)); const d = normalizeDomain(r.domain); if (d) exDomains.add(d); }
  }
  for (const r of (intEx ?? []) as Record<string, string | null>[]) { if (r.company_name) exNames.add(norm(r.company_name)); const d = normalizeDomain(r.company_website); if (d) exDomains.add(d); }
  const isEx = (p: ReceptivePerson) => { const n = norm(p.company); return (!!p.domain && exDomains.has(p.domain)) || (!!n && exNames.has(n)) || exKw.some((k) => k && n.includes(k)); };

  // Cartera del cliente (wishlist, cuentas trabajadas en Pulso, Centro): se marca, no se excluye
  const port = await getClientExclusions(db, clientId).catch(() => ({ domains: [] as string[], names: [] as string[], keywords: [] as string[] }));
  const portD = new Set(port.domains), portN = new Set(port.names.map((x) => norm(x)));

  let excluded = 0, already = 0, noTitle = 0;
  const cands: ReceptivePerson[] = [];
  for (const p of people) {
    if (belongsTo(p, clientId, client.name)) { already++; continue; }
    if (isEx(p)) { excluded++; continue; }
    if (!p.title?.trim() || !p.company?.trim()) { noTitle++; continue; }
    cands.push(p);
  }

  // Cargo vs buyer persona
  const titles = Array.from(new Set(cands.map((p) => p.title!.trim())));
  const { scores: tScores } = hasIcp ? await scoreTitlesForClient(db, clientId, titles) : { scores: new Map() };
  const tFit = (p: ReceptivePerson) => (tScores.get(p.title!.trim()) as { fit_score: number } | undefined)?.fit_score ?? 0;
  const titlePartial = cands.filter((p) => { const f = tFit(p); return f >= 40 && f < TITLE_MIN; }).length;
  const byTitle = cands.filter((p) => tFit(p) >= TITLE_MIN);

  // Empresa vs ICP (con datos del pool de HubSpot cuando hay dominio)
  const coKey = (p: ReceptivePerson) => p.domain ?? `n:${norm(p.company)}`;
  const coBest = new Map<string, ReceptivePerson>();
  for (const p of byTitle) { const k = coKey(p); if (!coBest.has(k) || coBest.get(k)!.score < p.score) coBest.set(k, p); }
  const coKeys = Array.from(coBest.keys()).sort((a, b) => coBest.get(b)!.score - coBest.get(a)!.score).slice(0, MAX_COMPANIES);
  const domains = coKeys.filter((k) => !k.startsWith("n:"));
  const pool = new Map<string, Record<string, string>>();
  for (let i = 0; i < domains.length; i += 200) {
    const { data } = await db.from("hubspot_company_pool").select("domain, properties").in("domain", domains.slice(i, i + 200));
    for (const r of (data ?? []) as { domain: string; properties: Record<string, string> }[]) pool.set(r.domain, r.properties);
  }
  const candidates = coKeys.map((k) => {
    const p = coBest.get(k)!, pr = pool.get(k) ?? {};
    const facts = [
      p.domain ? `Dominio: ${p.domain}` : null,
      pr.industry || p.industry ? `Industria: ${pr.industry || p.industry}` : null,
      pr.pais_g || p.country ? `País: ${pr.pais_g || p.country}` : null,
      pr.numberofemployees ? `Empleados: ${pr.numberofemployees}` : null,
      pr.annualrevenue ? `Facturación anual: ${pr.annualrevenue}` : null,
      pr.description ? `Descripción: ${String(pr.description).slice(0, 300)}` : null,
    ].filter(Boolean).join("\n");
    return { key: `rc:${k}`, name: p.company!, summary: facts || "Sin datos adicionales" };
  });
  const cScores = hasIcp ? await scoreCompanies(db, { clientId, icpText, source: "receptivos", candidates }) : new Map();

  // Armado + competencia
  const others = new Map<string, string>();
  const decisions = await loadDecisions(clientId);
  const out: Suggestion[] = [];
  for (const p of byTitle) {
    const fit = cScores.get(`rc:${coKey(p)}`);
    if (!fit || fit.existing_client || fit.fit_score < COMPANY_MIN) continue;
    for (const s of p.signals) if (s.client && s.client !== clientId && s.clientName) others.set(s.client, s.clientName);
    out.push({
      key: p.key, name: p.name, title: p.title, company: p.company, domain: p.domain, country: p.country, linkedin: p.linkedin,
      hasMobile: !!p.mobile, hasEmail: !!p.email, score: p.score, titleFit: tFit(p), companyFit: fit.fit_score, companyReason: fit.fit_reason,
      signals: p.signals.slice(0, 6).map((s) => ({ label: SIGNAL_LABEL[s.k as SignalKind], d: s.d.slice(0, 10), withOther: !!s.client && s.client !== clientId })),
      competitor: null,
      inPortfolio: (!!p.domain && portD.has(p.domain)) || portN.has(norm(p.company)),
    });
  }
  const comp = new Map<string, string | null>();
  for (const [id, name] of Array.from(others.entries())) comp.set(id, await competitorCheck({ id: clientId, name: client.name }, { id, name }).catch(() => null));
  for (const s of out) {
    const p = people.find((x) => x.key === s.key)!;
    const hit = p.signals.find((x) => x.client && comp.get(x.client));
    if (hit) s.competitor = { client: hit.clientName ?? "otro cliente", reason: comp.get(hit.client!)! };
  }
  out.sort((a, b) => b.score - a.score || b.titleFit - a.titleFit);

  const count = (arr: string[]) => { const m = new Map<string, number>(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return Array.from(m.entries()).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); };
  const finals = out.map((s) => people.find((x) => x.key === s.key)!);
  return {
    at: new Date().toISOString(), clientId, clientName: client.name, hasIcp,
    stats: {
      receptiveTotal: people.length, candidates: cands.length, excluded, alreadyThisClient: already, noTitle,
      titleFit: byTitle.length, titlePartial, companyFit: out.length, final: out.length,
      bySignal: count(finals.flatMap((p) => Array.from(new Set(p.signals.map((s) => SIGNAL_LABEL[s.k]))))),
      byCountry: count(finals.map((p) => p.country ?? "Sin país")).slice(0, 8),
      withCompetitor: out.filter((s) => s.competitor).length, inPortfolio: out.filter((s) => s.inPortfolio).length,
    },
    suggestions: out.map((s) => ({ ...s, decision: decisions.get(s.key) ?? null })),
  };
}

export async function getClientReceptivos(clientId: string, fresh = false): Promise<ClientReceptivos> {
  const key = `receptivos:cli:v1:${clientId}:${weekKey()}`;
  let r = fresh ? null : await readMonthCache<ClientReceptivos>(key);
  if (!r) { r = await compute(clientId); await writeMonthCache(key, { ...r, suggestions: r.suggestions.map((s) => ({ ...s, decision: null })) }, 8 * 86400_000); }
  const decisions = await loadDecisions(clientId);
  return { ...r, suggestions: r.suggestions.map((s) => ({ ...s, decision: decisions.get(s.key) ?? null })) };
}

// Resumen de todos los clientes con resultado ya calculado esta semana
export async function listCachedSummaries(): Promise<{ clientId: string; clientName: string; final: number; pending: number; loaded: number; at: string }[]> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("response").like("cache_key", `receptivos:cli:v1:%:${weekKey()}`).limit(200);
  const rows = (data ?? []) as { response: ClientReceptivos }[];
  const out = [];
  for (const { response: r } of rows) {
    const d = await loadDecisions(r.clientId);
    const loaded = r.suggestions.filter((s) => d.get(s.key)?.st === "cargado").length;
    const done = r.suggestions.filter((s) => d.has(s.key)).length;
    out.push({ clientId: r.clientId, clientName: r.clientName, final: r.stats.final, pending: r.stats.final - done, loaded, at: r.at });
  }
  return out.sort((a, b) => b.pending - a.pending);
}
