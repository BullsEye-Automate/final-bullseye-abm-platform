import crypto from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, getClientModel } from "./claude";
import { logAiUsage } from "./aiUsageLogger";
import { normalizeDomain } from "./hubspotPool";
import { getClientIcpText } from "./wishlist";
import { COUNTRIES } from "./unifiedFilterDefs";
import {
  addContactsToList,
  ensureContactList,
  getClientOwnLemlistKey,
  getLemlistEnrichment,
  getLemlistPeopleFilters,
  searchLemlistPeople,
  startLemlistEnrichment,
  upsertLemlistContact,
  type LemlistFilter,
  type LemlistFilterDef,
  type LemlistPerson,
} from "./lemlistDatabase";

// Contactos de las empresas de la wishlist, con IA.
//
// 1. Se buscan los empleados de la empresa en la base de personas de Lemlist
//    (key del cliente, sin créditos). Empresas grandes: se pre-filtra por
//    seniority / área derivados del buyer persona y se toman máx. 200.
// 2. La IA puntúa CARGOS únicos (no personas) contra el ICP, buyer persona y
//    propuesta de valor del cliente, entendiendo el contexto (no coincidencia
//    exacta del nombre del cargo). Los puntajes se cachean por cliente +
//    versión del buyer persona: un cargo ya visto no se vuelve a pagar.
// 3. Los mejores (fit >= MIN_FIT, máx. MAX_CONTACTS) quedan "suggested" para
//    revisión humana. Con menos de FEW_CONTACTS la empresa queda marcada para
//    búsqueda manual en Sales Navigator.
// 4. Aprendizaje: las aprobaciones y rechazos de prospección se pasan a la IA
//    como ejemplos; cada FEEDBACK_STEP revisiones cambia la versión del caché
//    y los cargos se vuelven a evaluar con lo aprendido.

export const MAX_CONTACTS = 8;
export const FEW_CONTACTS = 2;
const MIN_FIT = 60;
const PAGE_SIZE = 100;
const MAX_CANDIDATES = 200;
// Sobre este total de empleados se aplica el pre-filtro del buyer persona
const LARGE_COMPANY = 200;
const TITLE_BATCH = 30;
const FEEDBACK_STEP = 10;
const FEEDBACK_EXAMPLES = 40;
const PROMPT_VERSION = "contacts-v1";
// Pre-filtro + países objetivo (independiente del caché de cargos)
const PREFILTER_VERSION = "prefilter-v2";
// Contacto fuera de los países del ICP: se le resta esto al fit (un cargo con
// 85 queda en 55, bajo MIN_FIT, y no se sugiere). Sin ubicación no se castiga.
const OUT_OF_COUNTRY_PENALTY = 30;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
export const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);

type Feedback = { title: string; status: "approved" | "rejected"; reason: string | null };

async function loadFeedback(db: SupabaseClient, clientId: string): Promise<{ count: number; examples: Feedback[] }> {
  const { data, count } = await db
    .from("wishlist_contacts")
    .select("title, status, reject_reason", { count: "exact" })
    .eq("client_id", clientId)
    .in("status", ["approved", "rejected"])
    .order("reviewed_at", { ascending: false })
    .limit(FEEDBACK_EXAMPLES);
  return {
    count: count ?? 0,
    examples: (data ?? [])
      .filter((r) => r.title)
      .map((r) => ({ title: r.title as string, status: r.status as Feedback["status"], reason: r.reject_reason })),
  };
}

// ── Pre-filtro (seniority / área de Lemlist) y países objetivo del ICP ───

const PREFILTER_TOOL: Anthropic.Tool = {
  name: "set_prefilter",
  description: "Elige los valores de seniority y área que pueden contener al buyer persona, y los países donde se prospecta",
  input_schema: {
    type: "object",
    properties: {
      seniority: { type: "array", items: { type: "string" } },
      department: { type: "array", items: { type: "string" } },
      countries: { type: "array", items: { type: "string" }, description: "Países objetivo del ICP (valores exactos de la lista). Vacío si el ICP no limita geografía." },
    },
    required: ["seniority", "department", "countries"],
  },
};

type Prefilter = { seniority?: string[]; department?: string[]; countries?: string[] };

async function getPrefilter(db: SupabaseClient, clientId: string, icpText: string, defs: LemlistFilterDef[]): Promise<Prefilter> {
  const seniorityDef = defs.find((d) => d.filterId === "seniority");
  const departmentDef = defs.find((d) => d.filterId === "department");
  const seniorityOpts = seniorityDef?.values ?? [];
  const departmentOpts = departmentDef?.values?.length
    ? departmentDef.values
    : ["Sales", "Customer service", "Engineering", "Marketing", "Operations", "Human Resources", "Finance / Legal / Admin", "Other"];
  const countryOpts = COUNTRIES.map((c) => c.value);

  const hash = sha(`${PREFILTER_VERSION}\n${icpText}\n${seniorityOpts.join("|")}\n${departmentOpts.join("|")}`);
  const { data: cached } = await db.from("client_persona_filters").select("persona_hash, filters").eq("client_id", clientId).maybeSingle();
  if (cached?.persona_hash === hash) return cached.filters as Prefilter;

  const model = await getClientModel(db, clientId);
  const message = await anthropic().messages.create({
    model,
    max_tokens: 600,
    temperature: 0,
    system: `Eres analista de prospección B2B. Según el ICP y buyer persona del cliente, eliges en qué niveles de seniority y áreas de una empresa grande pueden estar los contactos a prospectar (decisores, influenciadores y usuarios de lo que vende el cliente). Sé generoso: es un pre-filtro para no revisar miles de empleados, después otra IA elige uno a uno. Además indica en qué países se prospecta según la geografía del ICP (dónde deben estar los contactos); si el ICP no limita la geografía, deja countries vacío. Usa SOLO valores de las listas.`,
    tools: [PREFILTER_TOOL],
    tool_choice: { type: "tool", name: PREFILTER_TOOL.name },
    messages: [
      {
        role: "user",
        content: `<icp>\n${icpText}\n</icp>\n\nSeniority disponibles: ${seniorityOpts.join(" | ") || "(no disponible)"}\nÁreas disponibles: ${departmentOpts.join(" | ")}\nPaíses disponibles: ${countryOpts.join(" | ")}`,
      },
    ],
  });
  void logAiUsage({ clientId, functionName: "wishlist_contacts_prefilter", model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = (block?.input ?? {}) as { seniority?: unknown[]; department?: unknown[]; countries?: unknown[] };
  const pick = (vals: unknown[] | undefined, opts: string[]) => {
    const m = new Map(opts.map((o) => [o.toLowerCase(), o]));
    return Array.from(new Set((vals ?? []).map((v) => m.get(String(v).toLowerCase())).filter((v): v is string => !!v)));
  };
  const filters: Prefilter = {};
  const s = pick(raw.seniority, seniorityOpts);
  const d = pick(raw.department, departmentOpts);
  if (s.length && s.length < seniorityOpts.length) filters.seniority = s;
  if (departmentDef && d.length && d.length < departmentOpts.length) filters.department = d;
  const c = pick(raw.countries, countryOpts);
  if (c.length) filters.countries = c;
  await db.from("client_persona_filters").upsert({ client_id: clientId, persona_hash: hash, filters, updated_at: new Date().toISOString() });
  return filters;
}

// ── Búsqueda de empleados de una empresa ─────────────────────────────────

type Attempt = { label: string; filters: LemlistFilter[]; total: number | null; matched: number; error?: string };

function sameCompany(p: LemlistPerson, company: { domain: string | null; linkedin: string | null; name: string }) {
  if (company.domain && p.company_domain) return p.company_domain === company.domain || p.company_domain.endsWith(`.${company.domain}`);
  const li = (u: string | null) => u?.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "") ?? null;
  if (company.linkedin && p.company_linkedin_url) return li(company.linkedin) === li(p.company_linkedin_url);
  const n = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!p.company_name && (n(p.company_name).includes(n(company.name)) || n(company.name).includes(n(p.company_name)));
}

async function findEmployees(
  apiKey: string,
  company: { domain: string | null; linkedin: string | null; name: string },
  defs: LemlistFilterDef[],
  prefilter: () => Promise<Prefilter>
): Promise<{ people: LemlistPerson[]; attempts: Attempt[]; limitation: number | null; prefiltered: Prefilter | null }> {
  const has = (id: string) => defs.some((d) => d.filterId === id);
  // Distintas formas de identificar a la empresa en Lemlist, de la más precisa a la menos
  const ways: { label: string; filter: LemlistFilter }[] = [];
  if (company.domain && has("currentCompanyWebsiteUrl")) {
    ways.push({ label: "sitio web", filter: { filterId: "currentCompanyWebsiteUrl", in: [company.domain], out: [] } });
  }
  if (company.linkedin && has("currentCompanyLinkedInUrl")) {
    ways.push({ label: "LinkedIn de la empresa", filter: { filterId: "currentCompanyLinkedInUrl", in: [company.linkedin], out: [] } });
  }
  if (has("currentCompany") || !defs.length) {
    ways.push({ label: "nombre", filter: { filterId: "currentCompany", in: [company.name], out: [] } });
  }

  const attempts: Attempt[] = [];
  let limitation: number | null = null;
  for (const way of ways) {
    const first = await searchLemlistPeople(apiKey, { filters: [way.filter], page: 1, size: PAGE_SIZE });
    if (!first.ok) {
      attempts.push({ label: way.label, filters: [way.filter], total: null, matched: 0, error: `${first.status}: ${first.error}` });
      continue;
    }
    limitation = first.data.limitation ?? limitation;
    let filters: LemlistFilter[] = [way.filter];
    let people = first.data.people;
    let total = first.data.total;
    let prefiltered: Prefilter | null = null;

    // Empresa grande: se repite la búsqueda solo con el seniority / área del buyer persona
    if ((total ?? people.length) > LARGE_COMPANY) {
      const pf = await prefilter();
      const extra: LemlistFilter[] = [];
      if (pf.seniority?.length) extra.push({ filterId: "seniority", in: pf.seniority, out: [] });
      if (pf.department?.length) extra.push({ filterId: "department", in: pf.department, out: [] });
      if (extra.length) {
        const narrowed = await searchLemlistPeople(apiKey, { filters: [way.filter, ...extra], page: 1, size: PAGE_SIZE });
        if (narrowed.ok && narrowed.data.people.length) {
          filters = [way.filter, ...extra];
          people = narrowed.data.people;
          total = narrowed.data.total;
          limitation = narrowed.data.limitation ?? limitation;
          prefiltered = pf;
        }
      }
    }
    // Segunda página si hay más (tope MAX_CANDIDATES)
    if (people.length === PAGE_SIZE && (total ?? 0) > PAGE_SIZE) {
      const second = await searchLemlistPeople(apiKey, { filters, page: 2, size: PAGE_SIZE });
      if (second.ok) {
        people = [...people, ...second.data.people];
        limitation = second.data.limitation ?? limitation;
      }
    }

    const matched = people.filter((p) => sameCompany(p, company)).slice(0, MAX_CANDIDATES);
    attempts.push({ label: way.label, filters, total, matched: matched.length });
    if (matched.length) return { people: matched, attempts, limitation, prefiltered };
  }
  return { people: [], attempts, limitation, prefiltered: null };
}

// ── Puntaje de cargos con IA ─────────────────────────────────────────────

const TITLES_TOOL: Anthropic.Tool = {
  name: "score_titles",
  description: "Puntúa cada cargo como contacto a prospectar",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer", description: "Número del cargo en la lista" },
            fit_score: { type: "integer", minimum: 0, maximum: 100 },
            buying_role: { type: "string", enum: ["decisor", "influenciador", "usuario", "ninguno"] },
            reason: { type: "string" },
          },
          required: ["i", "fit_score", "buying_role", "reason"],
        },
      },
    },
    required: ["results"],
  },
};

const TITLES_SYSTEM = `Eres SDR senior de BullsEye, agencia de prospección B2B en Latinoamérica.
Recibes el ICP, buyer persona y propuesta de valor de un cliente de BullsEye, y una lista de cargos de empleados de empresas objetivo.
Para cada cargo decide qué tan buen contacto es para prospectar lo que vende el cliente:
- Entiende el CONTEXTO: qué resuelve el cliente, quién sufre ese problema, quién decide la compra y quién la influye. No exijas coincidencia exacta con los cargos del buyer persona: un cargo con otro nombre pero las mismas responsabilidades es fit (ej. "Jefe de Infraestructura TI" puede calzar con "CTO / Gerente de TI").
- Cargos en otros idiomas o abreviados (VP, Head of, Gte., Subgte.) se interpretan igual.
- fit_score 0–100: 80+ contacto ideal, 60–79 buen contacto, <60 no prospectar. Respeta los cargos a evitar del ICP.
- buying_role: decisor (aprueba la compra), influenciador (la recomienda o evalúa), usuario (la usaría), ninguno.
- reason: máx. 15 palabras en español.
- Si hay revisiones previas del equipo de prospección, aprende de ellas: cargos parecidos a los rechazados bajan y a los aprobados suben.
Devuelve un resultado por cada cargo usando su número.`;

type TitleScore = { fit_score: number; buying_role: string; reason: string };

async function scoreTitles(
  db: SupabaseClient,
  clientId: string,
  icpText: string,
  feedback: { count: number; examples: Feedback[] },
  titles: string[]
): Promise<Map<string, TitleScore>> {
  const out = new Map<string, TitleScore>();
  const unique = Array.from(new Set(titles.map(normTitle).filter(Boolean)));
  if (!unique.length) return out;
  const hash = sha(`${PROMPT_VERSION}\n${icpText}\nfeedback:${Math.floor(feedback.count / FEEDBACK_STEP)}`);

  for (let i = 0; i < unique.length; i += 500) {
    const { data } = await db
      .from("persona_title_scores")
      .select("title_norm, fit_score, buying_role, fit_reason")
      .eq("client_id", clientId)
      .eq("persona_hash", hash)
      .in("title_norm", unique.slice(i, i + 500));
    for (const r of data ?? []) out.set(r.title_norm, { fit_score: r.fit_score, buying_role: r.buying_role ?? "ninguno", reason: r.fit_reason ?? "" });
  }
  const pending = unique.filter((t) => !out.has(t));
  if (!pending.length) return out;

  const feedbackText = feedback.examples.length
    ? feedback.examples
        .map((f) => `- ${f.title}: ${f.status === "approved" ? "APROBADO" : "RECHAZADO"}${f.reason ? ` (${f.reason})` : ""}`)
        .join("\n")
    : "(sin revisiones todavía)";

  const model = await getClientModel(db, clientId);
  const batches: string[][] = [];
  for (let i = 0; i < pending.length; i += TITLE_BATCH) batches.push(pending.slice(i, i + TITLE_BATCH));

  await Promise.all(
    batches.map(async (batch) => {
      const message = await anthropic().messages.create({
        model,
        max_tokens: 4000,
        temperature: 0,
        system: [{ type: "text", text: TITLES_SYSTEM }],
        tools: [TITLES_TOOL],
        tool_choice: { type: "tool", name: TITLES_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              // ICP + revisiones se repiten en cada lote: van cacheados
              {
                type: "text",
                text: `<icp>\n${icpText}\n</icp>\n\n<revisiones_prospeccion>\n${feedbackText}\n</revisiones_prospeccion>`,
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: `<cargos>\n${batch.map((t, idx) => `${idx + 1}. ${t}`).join("\n")}\n</cargos>` },
            ],
          },
        ],
      });
      void logAiUsage({
        clientId,
        functionName: "wishlist_contacts_titles",
        model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        metadata: { titles: batch.length },
      });
      const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results = ((block?.input as { results?: { i: number; fit_score: number; buying_role: string; reason: string }[] })?.results ?? []);
      const rows = results
        .filter((r) => r.i >= 1 && r.i <= batch.length)
        .map((r) => ({
          client_id: clientId,
          persona_hash: hash,
          title_norm: batch[r.i - 1],
          fit_score: Math.max(0, Math.min(100, Math.round(Number(r.fit_score) || 0))),
          buying_role: ["decisor", "influenciador", "usuario"].includes(r.buying_role) ? r.buying_role : "ninguno",
          fit_reason: String(r.reason ?? "").slice(0, 300),
        }));
      for (const r of rows) out.set(r.title_norm, { fit_score: r.fit_score, buying_role: r.buying_role, reason: r.fit_reason });
      if (rows.length) await db.from("persona_title_scores").upsert(rows, { onConflict: "client_id,persona_hash,title_norm" });
    })
  );
  return out;
}

// ── Búsqueda completa para una empresa de la wishlist ────────────────────

// ¿La persona está en alguno de los países objetivo? null = no se sabe (sin ubicación)
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function inTargetCountries(location: string | null, targets: string[]): boolean | null {
  if (!targets.length) return true;
  if (!location?.trim()) return null;
  const loc = fold(location);
  return targets.some((t) => {
    const c = COUNTRIES.find((x) => x.value === t);
    const names = [t, c?.label, ...(c?.hubspot ?? [])].filter((n): n is string => !!n && n.length > 2);
    return names.some((n) => new RegExp(`(^|[^a-z])${fold(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(loc));
  });
}

// El puntaje del cargo es el mismo para todas las personas; la ubicación es
// de cada una: fuera de los países del ICP se resta OUT_OF_COUNTRY_PENALTY
function adjustForCountry(s: TitleScore | undefined, p: LemlistPerson, targets: string[]): TitleScore | undefined {
  if (!s || inTargetCountries(p.location, targets) !== false) return s;
  return {
    ...s,
    fit_score: Math.max(0, s.fit_score - OUT_OF_COUNTRY_PENALTY),
    reason: `${s.reason} (fuera de los países del ICP)`.slice(0, 300),
  };
}

const ROLE_RANK: Record<string, number> = { decisor: 3, influenciador: 2, usuario: 1, ninguno: 0 };

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export async function searchWishlistContacts(
  db: SupabaseClient,
  wishlistId: string
): Promise<{ ok: boolean; found: number; status: string; error?: string; limitation?: number | null }> {
  const { data: item } = await db
    .from("client_wishlist")
    .select("id, client_id, company_name, domain, linkedin_url")
    .eq("id", wishlistId)
    .maybeSingle();
  if (!item) return { ok: false, found: 0, status: "error", error: "Empresa no encontrada" };

  const fail = async (error: string, debug?: unknown) => {
    await db
      .from("client_wishlist")
      .update({ contacts_status: "error", contacts_error: error.slice(0, 500), contacts_debug: debug ?? null, contacts_searched_at: new Date().toISOString() })
      .eq("id", item.id);
    return { ok: false, found: 0, status: "error", error };
  };

  const apiKey = await getClientOwnLemlistKey(db, item.client_id);
  if (!apiKey) return fail("El cliente no tiene API key de Lemlist en Config. cliente");
  const icpText = await getClientIcpText(db, item.client_id);
  if (!icpText.trim()) return fail("El cliente no tiene ICP / buyer persona cargado");

  const defsRes = await getLemlistPeopleFilters(apiKey);
  const defs = defsRes.ok ? defsRes.data : [];
  let prefilterCache: Prefilter | null = null;
  const prefilter = async () => (prefilterCache ??= await getPrefilter(db, item.client_id, icpText, defs));

  const company = { domain: normalizeDomain(item.domain), linkedin: item.linkedin_url, name: item.company_name };
  const { people, attempts, limitation, prefiltered } = await findEmployees(apiKey, company, defs, prefilter);
  // Países objetivo del ICP (cacheado; una llamada a la IA por cliente)
  const targetCountries = (await prefilter()).countries ?? [];
  const debug = {
    attempts,
    limitation,
    prefilter: prefiltered,
    candidates: people.length,
    target_countries: targetCountries,
    // Filtros de personas que expone Lemlist para esta cuenta (diagnóstico)
    available_filters: defs.map((d) => d.filterId),
  };
  if (attempts.length && attempts.every((a) => a.error)) return fail(`Lemlist: ${attempts[0].error}`, debug);

  const feedback = await loadFeedback(db, item.client_id);
  const scores = await scoreTitles(db, item.client_id, icpText, feedback, people.map((p) => p.title ?? ""));

  // Las personas ya revisadas en esta empresa no se vuelven a sugerir
  const { data: existing } = await db.from("wishlist_contacts").select("lead_id, status").eq("wishlist_id", item.id);
  const reviewed = new Set((existing ?? []).filter((e) => e.status !== "suggested").map((e) => e.lead_id));
  const keptApproved = (existing ?? []).filter((e) => e.status === "approved").length;

  const seen = new Set<string>();
  const ranked = people
    .filter((p) => !reviewed.has(p.lead_id))
    .map((p) => ({ p, s: adjustForCountry(scores.get(normTitle(p.title ?? "")), p, targetCountries) }))
    .filter((x): x is { p: LemlistPerson; s: TitleScore } => !!x.s && x.s.fit_score >= MIN_FIT)
    .sort((a, b) => b.s.fit_score - a.s.fit_score || (ROLE_RANK[b.s.buying_role] ?? 0) - (ROLE_RANK[a.s.buying_role] ?? 0))
    .filter(({ p }) => {
      const k = p.linkedin_url ?? p.lead_id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, Math.max(0, MAX_CONTACTS - keptApproved));

  // Se reemplazan las sugerencias anteriores sin revisar por las nuevas
  await db.from("wishlist_contacts").delete().eq("wishlist_id", item.id).eq("status", "suggested");
  if (ranked.length) {
    const { error } = await db.from("wishlist_contacts").insert(
      ranked.map(({ p, s }) => {
        const n = splitName(p.full_name);
        return {
          client_id: item.client_id,
          wishlist_id: item.id,
          lead_id: p.lead_id,
          full_name: p.full_name,
          first_name: n.first,
          last_name: n.last,
          title: p.title,
          linkedin_url: p.linkedin_url,
          location: p.location,
          seniority: p.seniority,
          department: p.department,
          fit_score: s.fit_score,
          buying_role: s.buying_role,
          fit_reason: s.reason,
        };
      })
    );
    if (error) return fail(`Guardar contactos: ${error.message}`, debug);
  }

  const found = ranked.length + keptApproved;
  const status = found < FEW_CONTACTS ? "few_contacts" : "done";
  await db
    .from("client_wishlist")
    .update({
      contacts_status: status,
      contacts_found: found,
      contacts_error: null,
      contacts_debug: debug,
      contacts_searched_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  return { ok: true, found, status, limitation };
}

// ── Revisión humana ──────────────────────────────────────────────────────

export async function rejectWishlistContact(db: SupabaseClient, contactId: string, reason: string | null, email: string | null) {
  return db
    .from("wishlist_contacts")
    .update({ status: "rejected", reject_reason: reason?.slice(0, 300) || null, reviewed_by_email: email, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", contactId);
}

// Aprobar: se crea el contacto en el Lemlist del cliente (ligado a la
// empresa), se suma a la lista "Contactos Wishlist BullsEye" y se pide
// email + teléfono (créditos de Lemlist del cliente).
export async function approveWishlistContact(
  db: SupabaseClient,
  contactId: string,
  email: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await db
    .from("wishlist_contacts")
    .select("*, client_wishlist(company_name, domain, linkedin_url, snapshot)")
    .eq("id", contactId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Contacto no encontrado" };
  const wl = (Array.isArray(c.client_wishlist) ? c.client_wishlist[0] : c.client_wishlist) as
    | { company_name: string; domain: string | null; linkedin_url: string | null; snapshot: { lemlist_company_id?: string } | null }
    | null;

  const now = new Date().toISOString();
  await db.from("wishlist_contacts").update({ status: "approved", reviewed_by_email: email, reviewed_at: now, updated_at: now }).eq("id", c.id);

  const apiKey = await getClientOwnLemlistKey(db, c.client_id);
  if (!apiKey) {
    await db.from("wishlist_contacts").update({ lemlist_error: "El cliente no tiene API key de Lemlist" }).eq("id", c.id);
    return { ok: false, error: "sin_key" };
  }

  const errors: string[] = [];
  let lemlistContactId: string | null = c.lemlist_contact_id;
  if (!lemlistContactId) {
    const up = await upsertLemlistContact(apiKey, {
      linkedinUrl: c.linkedin_url,
      firstName: c.first_name,
      lastName: c.last_name,
      jobTitle: c.title,
      location: c.location,
      peopleDbSeniority: c.seniority,
      peopleDbDepartment: c.department,
      ...(wl?.snapshot?.lemlist_company_id ? { companyId: wl.snapshot.lemlist_company_id } : { companyDomain: wl?.domain ?? null }),
    });
    if (up.ok) {
      lemlistContactId = up.data.contactId;
      const list = await ensureContactList(apiKey);
      const added = list.ok ? await addContactsToList(apiKey, list.data.listId, [lemlistContactId]) : list;
      if (!added.ok) errors.push(`Lista (${added.status}): ${added.error}`);
    } else {
      errors.push(`Crear contacto (${up.status}): ${up.error}`);
    }
  }

  let enrichId: string | null = c.enrich_id;
  let enrichStatus: string = c.enrich_status;
  if (!enrichId) {
    const en = await startLemlistEnrichment(apiKey, {
      linkedinUrl: c.linkedin_url,
      firstName: c.first_name,
      lastName: c.last_name,
      companyName: wl?.company_name ?? null,
      companyDomain: wl?.domain ?? null,
      jobTitle: c.title,
    });
    if (en.ok) {
      enrichId = en.data.enrichId;
      enrichStatus = "pending";
    } else {
      enrichStatus = "error";
      errors.push(`Email/teléfono (${en.status}): ${en.error}`);
    }
  }

  await db
    .from("wishlist_contacts")
    .update({
      lemlist_contact_id: lemlistContactId,
      enrich_id: enrichId,
      enrich_status: enrichStatus,
      lemlist_error: errors.length ? errors.join(" · ").slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.id);
  return errors.length ? { ok: false, error: errors.join(" · ") } : { ok: true };
}

// Busca un string en el resultado del enriquecimiento (el formato del teléfono no está documentado)
function deepPick(v: unknown, keys: string[]): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.notFound === true) return null;
  for (const k of keys) {
    const r = deepPick(o[k], keys);
    if (r) return r;
  }
  return null;
}

// Revisa los enriquecimientos pendientes del cliente y guarda email / teléfono
// (también en el contacto de Lemlist)
export async function refreshEnrichments(db: SupabaseClient, clientId: string): Promise<{ checked: number; done: number }> {
  const { data: rows } = await db
    .from("wishlist_contacts")
    .select("id, enrich_id, lemlist_contact_id")
    .eq("client_id", clientId)
    .eq("enrich_status", "pending")
    .not("enrich_id", "is", null)
    .limit(50);
  if (!rows?.length) return { checked: 0, done: 0 };
  const apiKey = await getClientOwnLemlistKey(db, clientId);
  if (!apiKey) return { checked: 0, done: 0 };

  let done = 0;
  for (const r of rows) {
    const res = await getLemlistEnrichment(apiKey, r.enrich_id as string);
    if (!res.ok) continue;
    const status = String(res.data.enrichmentStatus ?? res.data.status ?? "");
    if (status && status !== "done" && status !== "error" && status !== "failed") continue;
    const data = (res.data.data ?? {}) as Record<string, unknown>;
    const email = deepPick(data.email, ["email", "value"]);
    const phone = deepPick(data.phone, ["phone", "phoneNumber", "number", "value", "mobile"]);
    await db
      .from("wishlist_contacts")
      .update({
        enrich_status: status === "done" || email || phone ? "done" : "error",
        email,
        phone,
        enrich_raw: res.data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (r.lemlist_contact_id && (email || phone)) {
      await upsertLemlistContact(apiKey, { contactId: r.lemlist_contact_id, email, phone }, "overwriteIgnoreEmpty");
    }
    done++;
  }
  return { checked: rows.length, done };
}
