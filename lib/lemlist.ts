import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, CLAUDE_MODEL } from "./claude";

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

function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function orNull(v: string): string | null {
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
export async function inferCompanyNameFromBioRaw(bio: string): Promise<string> {
  const msg = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 30,
    system: `Te doy la bio de LinkedIn de una persona. Respondé SOLO con el nombre de la empresa donde trabaja actualmente, tal como aparece mencionado en el texto — nada más, sin explicación. Si el texto no menciona el nombre de una empresa actual, respondé exactamente: NINGUNA`,
    messages: [{ role: "user", content: bio.slice(0, 3000) }],
  });
  const text = msg.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string } | undefined;
  const answer = text?.text.trim() ?? "";
  if (!answer || /^ninguna$/i.test(answer)) return "";
  return answer.replace(/^["'.]+|["'.]+$/g, "").slice(0, 120);
}

async function inferCompanyNameFromBio(bio: string): Promise<string> {
  try {
    return await inferCompanyNameFromBioRaw(bio);
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
function mapRawLead(raw: Record<string, unknown>): LemlistLeadDetail {
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
  const linkedinUrl = pick(raw, "linkedinUrl", "linkedin_url") || pick(vars, "linkedinUrl", "linkedin_url");
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
  apiKey: string
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
    if (!lead.linkedin_url) lead.linkedin_url = orNull(pick(c, "linkedinUrl", "linkedin_url") || pick(cVars, "linkedinUrl", "linkedin_url"));
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
        if (lead) lead.company_name = await inferCompanyNameFromBio(bio);
      })
    );
  }

  return { ok: true, leads, matched_url };
}
