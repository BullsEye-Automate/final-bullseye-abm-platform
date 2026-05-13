// Cliente para Lemlist API v2. Usado por la app para empujar contactos
// manual_review aprobados directamente a la campaña, evitando Clay (cuya
// API REST no expone CRUD de filas — ver CLAUDE.md sección "Investigación
// Clay API").
//
// Auth: Basic auth con usuario vacío y password = LEMLIST_API_KEY. Es la
// forma documentada de Lemlist desde hace años y la más estable.
//
// Endpoint: POST /api/v2/campaigns/{campaignId}/leads
//
// Custom fields (icebreaker, emailSubject, emailBody, wecad_fit_*) se
// auto-crean en Lemlist la primera vez que reciben valor — no requiere
// configuración previa.

const LEMLIST_API_BASE = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";

export type LemlistLead = {
  linkedinUrl?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  icebreaker: string;
  emailSubject: string;
  emailBody: string;
  wecad_fit_score?: number | null;
  wecad_fit_reason?: string | null;
  wecad_fit_action?: string | null;
};

export type LemlistPushResult =
  | { ok: true; leadId?: string; status: number; response: unknown }
  | { ok: false; status: number; error: string; debug?: unknown };

function buildAuthHeader(): string {
  const key = process.env.LEMLIST_API_KEY ?? "";
  // Lemlist usa usuario vacío + API key como password en Basic auth.
  const token = Buffer.from(`:${key}`).toString("base64");
  return `Basic ${token}`;
}

function buildPayload(lead: LemlistLead): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (lead.linkedinUrl) payload.linkedinUrl = lead.linkedinUrl;
  if (lead.email) payload.email = lead.email;
  if (lead.firstName) payload.firstName = lead.firstName;
  if (lead.lastName) payload.lastName = lead.lastName;
  if (lead.companyName) payload.companyName = lead.companyName;
  if (lead.jobTitle) payload.jobTitle = lead.jobTitle;
  if (lead.phone) payload.phone = lead.phone;
  payload.icebreaker = lead.icebreaker;
  payload.emailSubject = lead.emailSubject;
  payload.emailBody = lead.emailBody;
  if (lead.wecad_fit_score != null) payload.wecad_fit_score = lead.wecad_fit_score;
  if (lead.wecad_fit_reason) payload.wecad_fit_reason = lead.wecad_fit_reason;
  if (lead.wecad_fit_action) payload.wecad_fit_action = lead.wecad_fit_action;
  return payload;
}

export async function addLeadToCampaign(
  campaignId: string,
  lead: LemlistLead
): Promise<LemlistPushResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  }
  if (!campaignId) {
    return { ok: false, status: 500, error: "campaignId is empty" };
  }
  if (!lead.linkedinUrl && !lead.email) {
    return {
      ok: false,
      status: 400,
      error: "Lead has neither linkedinUrl nor email — Lemlist needs at least one"
    };
  }

  const url = `${LEMLIST_API_BASE}/v2/campaigns/${encodeURIComponent(campaignId)}/leads`;
  const payload = buildPayload(lead);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error calling Lemlist";
    return {
      ok: false,
      status: 502,
      error: message,
      debug: { url, payload }
    };
  }

  const rawText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = { raw: rawText.slice(0, 600) };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `Lemlist responded ${res.status}`,
      debug: { url, payload, response: parsed }
    };
  }

  const leadId =
    (parsed as { _id?: string; id?: string })?._id ??
    (parsed as { _id?: string; id?: string })?.id;

  return { ok: true, leadId, status: res.status, response: parsed };
}
