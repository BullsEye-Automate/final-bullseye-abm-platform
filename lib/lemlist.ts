import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, HAIKU_MODEL } from "./claude";
import { logAiUsage } from "./aiUsageLogger";

// Datos normalizados de un lead de campaña de Lemlist, ya completos.
export type LemlistLeadDetail = {
  id: string;
  contact_id: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
  company_name: string;
  job_title: string;
  linkedin_url: string | null;
  phone: string | null;
  added_at: string | null;
};

export type CampaignLeadsResult =
  | { ok: true; leads: LemlistLeadDetail[]; matched_url: string }
  | { ok: false; error: string };

// Resuelve la config de Lemlist del cliente activo desde client_configs.
// Nunca desde una env var global — cada cliente tiene su propia campaña puente.
export async function getClientLemlistConfig(
  db: SupabaseClient,
  clientId: string
): Promise<{
  lemlist_campaign_id: string | null;
  lemlist_staging_campaign_id: string | null;
  lemlist_manual_search_campaign_id: string | null;
} | null> {
  const { data } = await db
    .from("client_configs")
    .select("lemlist_campaign_id, lemlist_staging_campaign_id, lemlist_manual_search_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  return {
    lemlist_campaign_id: data.lemlist_campaign_id ?? null,
    lemlist_staging_campaign_id: data.lemlist_staging_campaign_id ?? null,
    lemlist_manual_search_campaign_id: (data as any).lemlist_manual_search_campaign_id ?? null,
  };
}

// La Campaña puente de Búsqueda manual es idealmente una campaña separada de
// lemlist_staging_campaign_id (que usa /api/lemlist/lookup-phone para
// enriquecer teléfonos 1 a 1) — compartirla mezcla leads de ambos procesos.
// Si el cliente todavía no configuró una dedicada, cae a la compartida.
export function resolveManualSearchCampaignId(config: {
  lemlist_staging_campaign_id: string | null;
  lemlist_manual_search_campaign_id: string | null;
} | null): string | null {
  return config?.lemlist_manual_search_campaign_id ?? config?.lemlist_staging_campaign_id ?? null;
}

export function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function orNull(v: string): string | null {
  return v || null;
}

// ⚠️ Confirmado con datos reales: cuando el lead se agrega desde LinkedIn
// Sales Navigator (linkedinUrlSalesNav presente), el enrich de Lemlist NO
// devuelve companyName como campo estructurado — solo bio/summary/
// jobDescription/companyDescription/tagline en texto libre. Muchas veces el
// nombre de la empresa SÍ aparece mencionado en ese texto (ej. "actualmente
// Marketing Manager en VGroup"), así que como último recurso se lo pedimos a
// Claude en vez de dejar el contacto "sin empresa".
// Variante sin try/catch — para que el endpoint de debug pueda ver el error
// real si Claude falla, en vez de que quede silenciado como "".
export async function inferCompanyNameFromBioRaw(bio: string, clientId?: string, userId?: string | null): Promise<string> {
  const msg = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 30,
    system: `Te doy la bio de LinkedIn de una persona. Respondé SOLO con el nombre de la empresa donde trabaja actualmente, tal como aparece mencionado en el texto — nada más, sin explicación. Si el texto no menciona el nombre de una empresa actual, respondé exactamente: NINGUNA`,
    messages: [{ role: "user", content: bio.slice(0, 3000) }],
  });
  void logAiUsage({ userId, clientId, functionName: "infer_company_name_from_bio", model: HAIKU_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  const text = msg.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string } | undefined;
  const answer = text?.text.trim() ?? "";
  if (!answer || /^ninguna$/i.test(answer)) return "";
  return answer.replace(/^["'.]+|["'.]+$/g, "").slice(0, 120);
}

async function inferCompanyNameFromBio(bio: string, clientId?: string, userId?: string | null): Promise<string> {
  try {
    return await inferCompanyNameFromBioRaw(bio, clientId, userId);
  } catch {
    return "";
  }
}

// ⚠️ Confirmado con datos reales: el list endpoint de campaña
// (GET /api/campaigns/{id}/leads) SÍ es minimalista — solo trae
// { _id, state, contactId }. No hay company/nombre/fecha ahí. Todo eso sale
// de GET /api/contacts/{contactId} (campo `fields`, no `vars` — se deja el
// fallback a `vars` por si Lemlist lo agrega en el futuro). El contacto
// tampoco tiene una fecha por-campaña — su único campo de fecha es
// `createdAt`, global al workspace. Para una campaña puente DEDICADA (que
// solo recibe leads nuevos) es una aproximación razonable de "cuándo se
// agregó"; si el mismo contacto ya existía de otra campaña, puede ser más
// vieja que el alta real a esta campaña — limitación conocida de la API.
export function mapRawLead(raw: Record<string, unknown>): LemlistLeadDetail {
  const vars = (raw.vars ?? raw.fields ?? {}) as Record<string, unknown>;

  let firstName = pick(raw, "firstName", "first_name") || pick(vars, "firstName", "first_name");
  let lastName = pick(raw, "lastName", "last_name") || pick(vars, "lastName", "last_name");
  if (!firstName && !lastName) {
    const fullName = pick(raw, "fullName", "full_name") || pick(vars, "fullName", "full_name");
    if (fullName) {
      const parts = fullName.split(/\s+/);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    }
  }

  const email = pick(raw, "email") || pick(vars, "email");
  // Los leads agregados desde LinkedIn Sales Navigator traen el LinkedIn bajo
  // linkedinUrlSalesNav, no linkedinUrl (ver enrich-existing/route.ts:87).
  const linkedinUrl =
    pick(raw, "linkedinUrl", "linkedin_url", "linkedinUrlSalesNav") ||
    pick(vars, "linkedinUrl", "linkedin_url", "linkedinUrlSalesNav");
  const phone = pick(raw, "phone") || pick(vars, "phone");
  const jobTitle = pick(raw, "jobTitle", "job_title", "title") || pick(vars, "jobTitle", "job_title", "tagline");
  let companyName = pick(raw, "companyName", "company_name", "company") || pick(vars, "companyName", "company_name", "company");

  if (!companyName) {
    const signalKey = Object.keys(vars).find((k) => k.startsWith("lastSignalData_"));
    if (signalKey) {
      try {
        const sd = JSON.parse(vars[signalKey] as string);
        companyName = sd?.data?.company?.fields?.name ?? "";
      } catch {
        /* ignorar */
      }
    }
  }

  // addedAt: fecha en que ESTE lead entró a ESTA campaña — nunca del contacto.
  const addedAt = pick(raw, "addedAt", "added_at", "createdAt", "created_at") || null;

  const contactId = (raw.contactId ?? null) as string | null;
  const id = (raw._id ?? contactId ?? email ?? linkedinUrl ?? "") as string;

  return {
    id,
    contact_id: contactId,
    email: orNull(email),
    first_name: firstName,
    last_name: lastName,
    company_name: companyName,
    job_title: jobTitle,
    linkedin_url: orNull(linkedinUrl),
    phone: orNull(phone),
    added_at: addedAt,
  };
}

// Trae TODOS los leads de una campaña de Lemlist con sus datos completos.
// Los datos base salen del list endpoint (por campaña); los leads que quedan
// incompletos (sin email/nombre/empresa) se completan con
// GET /api/contacts/{contactId}, SIN pisar los datos ya capturados por la
// campaña. Usar SIEMPRE esta función, nunca el list crudo.
export async function getCampaignLeadsWithDetails(
  campaignId: string,
  apiKey: string,
  clientId?: string,
  userId?: string | null
): Promise<CampaignLeadsResult> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const matched_url = `https://app.lemlist.com/campaigns/${campaignId}/leads`;

  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=100`,
    { headers: { Authorization: creds } }
  ).catch(() => null);

  if (!leadsRes) return { ok: false, error: "Error de red al conectar con Lemlist" };
  if (!leadsRes.ok) {
    const text = await leadsRes.text().catch(() => "");
    return { ok: false, error: `Lemlist ${leadsRes.status}: ${text.slice(0, 200)}` };
  }

  const payload = await leadsRes.json().catch(() => ({}));
  const rawLeads = (payload.items ?? (Array.isArray(payload) ? payload : [])) as Record<string, unknown>[];

  const leads = rawLeads.map(mapRawLead);

  const incomplete = leads.filter((l) => !l.email || (!l.first_name && !l.last_name) || !l.company_name);
  const contactIds = Array.from(new Set(incomplete.map((l) => l.contact_id).filter((v): v is string => Boolean(v))));

  const CHUNK = 5;
  const contactMap = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map(async (cid) => {
        const res = await fetch(`https://api.lemlist.com/api/contacts/${cid}`, { headers: { Authorization: creds } }).catch(() => null);
        if (!res?.ok) return null;
        const contact = await res.json().catch(() => null);
        return contact ? ([cid, contact] as const) : null;
      })
    );
    for (const r of results) {
      if (r) contactMap.set(r[0], r[1]);
    }
  }

  const bioByLeadId = new Map<string, string>();
  for (const lead of incomplete) {
    if (!lead.contact_id) continue;
    const c = contactMap.get(lead.contact_id);
    if (!c) continue;
    const cVars = (c.vars ?? c.fields ?? {}) as Record<string, unknown>;

    if (!lead.email) lead.email = orNull(pick(c, "email") || pick(cVars, "email"));
    if (!lead.linkedin_url) {
      lead.linkedin_url = orNull(
        pick(c, "linkedinUrl", "linkedin_url", "linkedinUrlSalesNav") ||
        pick(cVars, "linkedinUrl", "linkedin_url", "linkedinUrlSalesNav")
      );
    }
    if (!lead.phone) lead.phone = orNull(pick(c, "phone") || pick(cVars, "phone"));

    if (!lead.first_name && !lead.last_name) {
      const fullName = pick(c, "fullName", "full_name");
      if (fullName) {
        const parts = fullName.split(/\s+/);
        lead.first_name = parts[0] ?? "";
        lead.last_name = parts.slice(1).join(" ");
      } else {
        lead.first_name = pick(c, "firstName", "first_name") || pick(cVars, "firstName", "first_name");
        lead.last_name = pick(c, "lastName", "last_name") || pick(cVars, "lastName", "last_name");
      }
    }

    if (!lead.company_name) lead.company_name = pick(c, "companyName", "company_name", "company") || pick(cVars, "companyName", "company_name", "company");
    if (!lead.job_title) lead.job_title = pick(c, "jobTitle", "job_title", "title") || pick(cVars, "jobTitle", "job_title");
    if (!lead.added_at) lead.added_at = pick(c, "createdAt", "created_at") || null;

    // Último recurso: inferir la empresa desde la bio de LinkedIn (ver nota en inferCompanyNameFromBio).
    if (!lead.company_name) {
      const bio = [pick(cVars, "summary"), pick(cVars, "jobDescription"), pick(cVars, "companyDescription"), pick(cVars, "tagline")]
        .filter(Boolean)
        .join("\n\n");
      if (bio) bioByLeadId.set(lead.id, bio);
    }
  }

  const BIO_CHUNK = 5;
  const bioEntries = Array.from(bioByLeadId.entries());
  for (let i = 0; i < bioEntries.length; i += BIO_CHUNK) {
    const slice = bioEntries.slice(i, i + BIO_CHUNK);
    await Promise.all(
      slice.map(async ([leadId, bio]) => {
        const lead = leads.find((l) => l.id === leadId);
        if (lead) lead.company_name = await inferCompanyNameFromBio(bio, clientId, userId);
      })
    );
  }

  return { ok: true, leads, matched_url };
}

// ─── Reporte cross-campaña (todas las campañas del workspace) ─────────────────

export type LemlistCampaignRef = { id: string; name: string };

export async function listAllLemlistCampaigns(apiKey: string): Promise<LemlistCampaignRef[]> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const res = await fetch("https://api.lemlist.com/api/campaigns", { headers: { Authorization: creds } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lemlist ${res.status} listando campañas: ${text.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const items: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : ((data as any)?.campaigns ?? (data as any)?.items ?? []);
  return items.map((c) => ({
    id: (c._id ?? c.id) as string,
    name: (c.name as string) ?? "(sin nombre)",
  }));
}

async function fetchCampaignLeadsRaw(campaignId: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: creds } }
    );
    if (!res.ok) break;
    const data = await res.json().catch(() => null);
    const items = (data?.items ?? (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

// Completa email/nombre/empresa/fecha vía GET /contacts/{id} — sin la
// inferencia por IA de getCampaignLeadsWithDetails (sería costoso repetirla
// para potencialmente miles de leads en un reporte agregado). contactCache
// se comparte entre campañas para no pedir dos veces el mismo contacto si
// aparece en más de una.
async function enrichLeadsBasic(
  leads: LemlistLeadDetail[],
  apiKey: string,
  contactCache: Map<string, Record<string, unknown>>
): Promise<void> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const incomplete = leads.filter((l) => !l.email || (!l.first_name && !l.last_name) || !l.company_name);
  const contactIds = Array.from(
    new Set(incomplete.map((l) => l.contact_id).filter((v): v is string => v != null && !contactCache.has(v)))
  );

  const CHUNK = 5;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map(async (cid) => {
        const res = await fetch(`https://api.lemlist.com/api/contacts/${cid}`, { headers: { Authorization: creds } }).catch(() => null);
        if (!res?.ok) return null;
        const contact = await res.json().catch(() => null);
        return contact ? ([cid, contact] as const) : null;
      })
    );
    for (const r of results) if (r) contactCache.set(r[0], r[1]);
  }

  for (const lead of incomplete) {
    if (!lead.contact_id) continue;
    const c = contactCache.get(lead.contact_id);
    if (!c) continue;
    const cVars = (c.vars ?? c.fields ?? {}) as Record<string, unknown>;

    if (!lead.email) lead.email = orNull(pick(c, "email") || pick(cVars, "email"));
    if (!lead.first_name && !lead.last_name) {
      const fullName = pick(c, "fullName", "full_name");
      if (fullName) {
        const parts = fullName.split(/\s+/);
        lead.first_name = parts[0] ?? "";
        lead.last_name = parts.slice(1).join(" ");
      } else {
        lead.first_name = pick(c, "firstName", "first_name") || pick(cVars, "firstName", "first_name");
        lead.last_name = pick(c, "lastName", "last_name") || pick(cVars, "lastName", "last_name");
      }
    }
    if (!lead.company_name) lead.company_name = pick(c, "companyName", "company_name", "company") || pick(cVars, "companyName", "company_name", "company");
    if (!lead.job_title) lead.job_title = pick(c, "jobTitle", "job_title", "title") || pick(cVars, "jobTitle", "job_title");
    if (!lead.added_at) lead.added_at = pick(c, "createdAt", "created_at") || null;
  }
}

export type LemlistLeadWithCampaign = LemlistLeadDetail & {
  campaign_id: string;
  campaign_name: string;
  company_source: "lemlist" | "email" | null;
};

// Dominios de correo personal — nunca se usan para inferir el nombre de una
// empresa (un @gmail.com no dice nada del empleador de la persona).
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es",
  "yahoo.com", "yahoo.es", "yahoo.com.mx", "icloud.com", "live.com",
  "aol.com", "protonmail.com", "proton.me", "gmx.com", "yandex.com",
  "mail.com", "zoho.com", "me.com", "msn.com",
]);

// Último recurso cuando Lemlist no trae companyName ni para el lead ni para
// el contacto: se infiere desde el dominio del correo (ej. "@electrolux.com"
// → "Electrolux"). No es tan preciso como el nombre real (no distingue
// mayúsculas de siglas como "PwC"), pero es mejor que dejar el contacto sin
// empresa. Se excluyen dominios de correo personal a propósito.
export function deriveCompanyFromEmail(email: string | null): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return "";
  const name = domain.split(".")[0];
  if (!name || name.length < 2) return "";
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Trae los leads de TODAS las campañas del workspace (una fila por
// membresía campaña-contacto, un mismo contacto puede aparecer varias
// veces si está en más de una campaña). Sin inferencia por IA — ver
// enrichLeadsBasic. Procesa las campañas secuencialmente para no saturar
// la API de Lemlist con muchas campañas en paralelo.
export async function getAllCampaignsLeads(
  apiKey: string
): Promise<{ campaigns: LemlistCampaignRef[]; leads: LemlistLeadWithCampaign[] }> {
  const campaigns = await listAllLemlistCampaigns(apiKey);
  const contactCache = new Map<string, Record<string, unknown>>();
  const allLeads: LemlistLeadWithCampaign[] = [];

  for (const campaign of campaigns) {
    const raw = await fetchCampaignLeadsRaw(campaign.id, apiKey);
    if (raw.length === 0) continue;
    const leads = raw.map(mapRawLead);
    await enrichLeadsBasic(leads, apiKey, contactCache);
    for (const lead of leads) {
      let companySource: "lemlist" | "email" | null = lead.company_name ? "lemlist" : null;
      if (!lead.company_name) {
        const derived = deriveCompanyFromEmail(lead.email);
        if (derived) {
          lead.company_name = derived;
          companySource = "email";
        }
      }
      allLeads.push({ ...lead, campaign_id: campaign.id, campaign_name: campaign.name, company_source: companySource });
    }
  }

  return { campaigns, leads: allLeads };
}

// ─── Stats de engagement por campaña (para el reporte cross-campaña) ───────────

export type LemlistCampaignStats = {
  id: string;
  name: string;
  total: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
};

// Misma normalización de campos ya probada en app/api/lemlist/campaigns/route.ts
// (stats acumulados históricos de la campaña — Lemlist no permite filtrarlos
// por fecha en este endpoint).
export async function getCampaignStats(campaign: LemlistCampaignRef, apiKey: string): Promise<LemlistCampaignStats | null> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const res = await fetch(`https://api.lemlist.com/api/campaigns/${campaign.id}`, {
    headers: { Authorization: creds },
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const raw = data.stats ?? {};
  return {
    id: campaign.id,
    name: campaign.name,
    total: raw.total ?? 0,
    contacted: raw.contacted ?? raw.emailsCount ?? 0,
    opened: raw.opened ?? raw.openedCount ?? 0,
    clicked: raw.clicked ?? raw.clickedCount ?? 0,
    replied: raw.replied ?? raw.repliedCount ?? 0,
    bounced: raw.bounced ?? raw.bouncedCount ?? 0,
    unsubscribed: raw.unsubscribed ?? raw.unsubscribedCount ?? 0,
  };
}

export async function getAllCampaignsStats(
  campaigns: LemlistCampaignRef[],
  apiKey: string
): Promise<LemlistCampaignStats[]> {
  const CHUNK = 5;
  const out: LemlistCampaignStats[] = [];
  for (let i = 0; i < campaigns.length; i += CHUNK) {
    const slice = campaigns.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((c) => getCampaignStats(c, apiKey)));
    for (const r of results) if (r) out.push(r);
  }
  return out;
}

// ─── Actividades por contacto (para "lead scoring" e interacciones) ───────────
// Mismo modelo de puntaje que app/api/lemlist/actividad/route.ts (usado en
// /sdr/calientes) — se reutiliza para que el "lead scoring" signifique lo
// mismo en toda la app.

export const LEMLIST_ACTIVITY_TYPES = [
  { type: "emailsReplied", score: 10, label: "Respondió email" },
  { type: "linkedinReplied", score: 10, label: "Respondió en LinkedIn" },
  { type: "linkedinInviteAccepted", score: 7, label: "Aceptó conexión LinkedIn" },
  { type: "emailsClicked", score: 5, label: "Hizo clic en email" },
  { type: "linkedinVisited", score: 3, label: "Visitó perfil LinkedIn" },
  { type: "emailsOpened", score: 2, label: "Abrió email" },
] as const;

export type LemlistActivity = {
  type: string;
  score: number;
  label: string;
  email: string;
  createdAt: string | null;
  campaignId: string;
  campaignName: string;
};

async function fetchActivitiesForCampaign(
  campaignId: string,
  campaignName: string,
  apiKey: string
): Promise<LemlistActivity[]> {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
  const out: LemlistActivity[] = [];
  await Promise.all(
    LEMLIST_ACTIVITY_TYPES.map(async ({ type, score, label }) => {
      const res = await fetch(
        `https://api.lemlist.com/api/activities?type=${type}&campaignId=${campaignId}&limit=200`,
        { headers: { Authorization: creds } }
      ).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      const items: Record<string, unknown>[] = Array.isArray(data) ? data : (data?.data ?? data?.activities ?? []);
      for (const a of items) {
        const email = (pick(a, "email", "leadEmail") || "").toLowerCase();
        if (!email) continue;
        out.push({
          type,
          score,
          label,
          email,
          createdAt: (a.createdAt as string) ?? (a.date as string) ?? null,
          campaignId,
          campaignName,
        });
      }
    })
  );
  return out;
}

// Trae actividades (aperturas, clics, respuestas, conexiones LinkedIn, etc.)
// de un conjunto de campañas. Se limita deliberadamente a las campañas con
// actividad en el rango de fechas elegido (no todo el workspace) para no
// disparar cientos de llamadas a la API de Lemlist en cada carga.
export async function getAllCampaignsActivities(
  campaigns: LemlistCampaignRef[],
  apiKey: string
): Promise<LemlistActivity[]> {
  const CHUNK = 4;
  const out: LemlistActivity[] = [];
  for (let i = 0; i < campaigns.length; i += CHUNK) {
    const slice = campaigns.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((c) => fetchActivitiesForCampaign(c.id, c.name, apiKey)));
    for (const r of results) out.push(...r);
  }
  return out;
}
