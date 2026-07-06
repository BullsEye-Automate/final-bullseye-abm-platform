import type { SupabaseClient } from "@supabase/supabase-js";

// Datos normalizados de un lead de campaña de Lemlist, ya enriquecidos con
// GET /api/contacts/{contactId} (el list endpoint de campaña es minimalista:
// solo trae { _id, state, contactId }).
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
} | null> {
  const { data } = await db
    .from("client_configs")
    .select("lemlist_campaign_id, lemlist_staging_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  return {
    lemlist_campaign_id: data.lemlist_campaign_id ?? null,
    lemlist_staging_campaign_id: data.lemlist_staging_campaign_id ?? null,
  };
}

function extractLeadFields(raw: Record<string, unknown>): LemlistLeadDetail {
  const f = (raw.fields ?? {}) as Record<string, unknown>;
  const firstName = (f.firstName ?? raw.firstName ?? raw.first_name ?? "") as string;
  const lastName = (f.lastName ?? raw.lastName ?? raw.last_name ?? "") as string;
  const jobTitle = (f.jobTitle ?? raw.jobTitle ?? raw.job_title ?? f.tagline ?? "") as string;
  const email = (raw.email ?? f.email ?? null) as string | null;
  const linkedinUrl = (raw.linkedinUrl ?? raw.linkedin_url ?? null) as string | null;
  const phone = (raw.phone ?? f.phone ?? null) as string | null;
  const id = (raw._id ?? raw.contactId ?? email ?? linkedinUrl ?? "") as string;
  const contactId = (raw.contactId ?? null) as string | null;
  const addedAt = (raw.createdAt ?? raw.addedAt ?? raw.added_at ?? null) as string | null;

  let companyName = (f.companyName ?? raw.companyName ?? raw.company_name ?? "") as string;
  if (!companyName) {
    const signalKey = Object.keys(f).find((k) => k.startsWith("lastSignalData_"));
    if (signalKey) {
      try {
        const sd = JSON.parse(f[signalKey] as string);
        companyName = sd?.data?.company?.fields?.name ?? "";
      } catch {
        /* ignorar */
      }
    }
  }

  return {
    id,
    contact_id: contactId,
    email,
    first_name: firstName,
    last_name: lastName,
    company_name: companyName,
    job_title: jobTitle,
    linkedin_url: linkedinUrl,
    phone,
    added_at: addedAt,
  };
}

// Trae TODOS los leads de una campaña de Lemlist con sus datos completos.
// ⚠️ Gotcha: el list endpoint a nivel campaña (GET /api/campaigns/{id}/leads)
// es minimalista — solo devuelve { _id, state, contactId }. Para traer
// firstName/lastName/jobTitle/companyName/linkedinUrl/email/phone hay que
// pedir GET /api/contacts/{contactId} por cada lead, en paralelo por chunks.
// Usar SIEMPRE esta función, nunca el list crudo.
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

  const CHUNK = 5;
  const enriched: Record<string, unknown>[] = [];
  for (let i = 0; i < rawLeads.length; i += CHUNK) {
    const slice = rawLeads.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map(async (lead) => {
        const contactId = lead.contactId as string | undefined;
        if (!contactId) return lead;
        const res = await fetch(`https://api.lemlist.com/api/contacts/${contactId}`, {
          headers: { Authorization: creds },
        }).catch(() => null);
        if (!res?.ok) return lead;
        const contact = await res.json().catch(() => ({}));
        return { ...contact, ...lead };
      })
    );
    enriched.push(...results);
  }

  return { ok: true, leads: enriched.map(extractLeadFields), matched_url };
}
