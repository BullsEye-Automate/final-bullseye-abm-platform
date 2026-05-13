// Cliente para Lemlist API. Usado por la app para empujar contactos
// manual_review aprobados directamente a la campaña, evitando Clay (cuya
// API REST no expone CRUD de filas — ver CLAUDE.md sección "Investigación
// Clay API").
//
// Auth: Basic auth con usuario vacío y password = LEMLIST_API_KEY. Es la
// forma documentada de Lemlist desde hace años y la más estable.
//
// La estructura exacta del endpoint de "add lead to campaign" depende de
// la versión de la API. Probamos varios patrones en orden hasta encontrar
// uno que devuelva 2xx, y devolvemos `attempts` con el detalle de cada
// intento para diagnosticar desde la UI.

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

type FetchAttempt = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  response_preview: string;
};

export type LemlistPushResult =
  | { ok: true; leadId?: string; status: number; matched_url: string; attempts: FetchAttempt[] }
  | { ok: false; status: number; error: string; debug?: { attempts: FetchAttempt[] } };

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

// Patrones de URL a probar para "add lead to a campaign", en orden de
// preferencia. El primero es el v1 documentado en developer.lemlist.com
// que ha sido estable por años. El v2 es el namespace más nuevo pero
// menos consistente — lo dejamos como último recurso.
// Flags de enrichment para que Lemlist dispare su waterfall al insertar.
// Solo email — el teléfono cuesta 20 créditos vs 5 del email; mejor que
// el SDR pida teléfono manual con Lusha cuando lo necesite (Sprint 3+).
// linkedinEnrichment llena seniority/tenure desde LinkedIn (sin costo
// extra documentado). Lemlist ignora query params desconocidos silencioso.
const ENRICHMENT_QUERY = "findEmail=true&verifyEmail=true&linkedinEnrichment=true";

function buildCandidateRequests(
  campaignId: string,
  email: string | null | undefined
): Array<{ url: string; method: string }> {
  const id = encodeURIComponent(campaignId);
  const requests: Array<{ url: string; method: string }> = [];

  // v1 con email en URL — el más documentado. Solo si hay email.
  // No agregamos findEmail aquí porque ya tenemos email; solo verify.
  if (email) {
    const enc = encodeURIComponent(email);
    requests.push({
      url: `${LEMLIST_API_BASE}/campaigns/${id}/leads/${enc}?verifyEmail=true`,
      method: "POST"
    });
  }

  // v1 root sin email — Lemlist enriquece a partir de linkedinUrl.
  requests.push({
    url: `${LEMLIST_API_BASE}/campaigns/${id}/leads?${ENRICHMENT_QUERY}`,
    method: "POST"
  });

  // v2 — fallback, devolvió 405 en la primera prueba pero lo dejamos por
  // si Lemlist lo habilita más adelante.
  requests.push({
    url: `${LEMLIST_API_BASE}/v2/campaigns/${id}/leads?${ENRICHMENT_QUERY}`,
    method: "POST"
  });

  return requests;
}

async function tryRequest(
  url: string,
  method: string,
  payload: unknown
): Promise<FetchAttempt & { parsed: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: buildAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return {
      url,
      method,
      status: 0,
      ok: false,
      response_preview: message,
      parsed: null
    };
  }

  const rawText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = { raw: rawText.slice(0, 600) };
  }

  return {
    url,
    method,
    status: res.status,
    ok: res.ok,
    response_preview: rawText.slice(0, 400),
    parsed
  };
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

  const payload = buildPayload(lead);
  const candidates = buildCandidateRequests(campaignId, lead.email);
  const attempts: FetchAttempt[] = [];

  for (const req of candidates) {
    const result = await tryRequest(req.url, req.method, payload);
    attempts.push({
      url: result.url,
      method: result.method,
      status: result.status,
      ok: result.ok,
      response_preview: result.response_preview
    });
    if (result.ok) {
      const leadId =
        (result.parsed as { _id?: string; id?: string })?._id ??
        (result.parsed as { _id?: string; id?: string })?.id;
      return {
        ok: true,
        leadId,
        status: result.status,
        matched_url: result.url,
        attempts
      };
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 0,
    error: `Lemlist rejected the lead on all ${attempts.length} URL pattern(s) tried`,
    debug: { attempts }
  };
}
