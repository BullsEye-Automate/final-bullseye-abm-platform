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
  payload.icebreaker = lead.icebreaker.trim();
  payload.emailSubject = lead.emailSubject.trim();
  payload.emailBody = lead.emailBody.trim();
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
// Email + phone — Lemlist es ~10x más barato que Lusha por phone, así que
// pagamos Lemlist proactivo y reservamos Lusha solo como fallback cuando
// Lemlist no encuentra (lib/phoneEnrichment.ts).
// linkedinEnrichment llena seniority/tenure desde LinkedIn (sin costo
// extra documentado). Lemlist ignora query params desconocidos silencioso.
const ENRICHMENT_QUERY =
  "findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true";

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
      url: `${LEMLIST_API_BASE}/campaigns/${id}/leads/${enc}?verifyEmail=true&findPhone=true`,
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
  // Guard de borde: nunca empujar un lead con las variables de la secuencia
  // en blanco. Lemlist lo aceptaría pero después muestra "{{icebreaker}} has
  // no value" y el toque de LinkedIn / email sale roto.
  const missing = [
    !lead.icebreaker?.trim() && "icebreaker",
    !lead.emailSubject?.trim() && "emailSubject",
    !lead.emailBody?.trim() && "emailBody"
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Lead has blank ${missing.join(", ")} — refusing to push (Lemlist would warn "{{variable}} has no value")`
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

// ============================================================================
// GET lead — devuelve el estado actual del lead (enriquecimientos incluidos).
// Probamos varios URL patterns igual que el push, porque Lemlist no documenta
// claramente la canonical URL y los endpoints han variado entre versiones.
// ============================================================================

export type LemlistLeadFetched = {
  _id?: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  directPhone?: string | null;
  // Lemlist a veces guarda los teléfonos en custom fields anidados; los
  // intentamos también más abajo (extractPhone).
  [key: string]: unknown;
};

export type LemlistGetAttempt = { url: string; status: number; preview: string };

export type LemlistGetResult =
  | {
      ok: true;
      status: number;
      lead: LemlistLeadFetched;
      phone: string | null;
      matched_url: string;
      raw: string;
      attempts: LemlistGetAttempt[];
    }
  | { ok: false; status: number; error: string; debug?: unknown };

function extractPhone(lead: LemlistLeadFetched): string | null {
  // Lemlist mete teléfonos en varios campos según el origen del enrichment
  // (LinkedIn enrichment vs phone finder vs manual). Probamos en orden.
  const candidates = [
    lead.phone,
    lead.mobilePhone,
    lead.directPhone,
    (lead as Record<string, unknown>).phoneNumber,
    (lead as Record<string, unknown>).workPhone
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 4) return c.trim();
  }
  return null;
}

export async function getLemlistLeadByEmail(
  campaignId: string,
  email: string
): Promise<LemlistGetResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  }
  const id = encodeURIComponent(campaignId);
  const enc = encodeURIComponent(email);
  // v1 primero — el v2 leads-by-email no es una ruta real (devuelve el HTML
  // del SPA de Lemlist con 200). Lo dejamos último por si lo habilitan.
  const urls = [
    `${LEMLIST_API_BASE}/campaigns/${id}/leads/${enc}`,
    `${LEMLIST_API_BASE}/leads/${enc}`,
    `${LEMLIST_API_BASE}/leads/${enc}?campaignId=${id}`,
    `${LEMLIST_API_BASE}/v2/campaigns/${id}/leads/${enc}`
  ];
  return tryGetUrls(urls);
}

export async function getLemlistLeadById(leadId: string): Promise<LemlistGetResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  }
  const enc = encodeURIComponent(leadId);
  const urls = [
    `${LEMLIST_API_BASE}/v2/leads/${enc}`,
    `${LEMLIST_API_BASE}/leads/${enc}`
  ];
  return tryGetUrls(urls);
}

async function tryGetUrls(urls: string[]): Promise<LemlistGetResult> {
  const attempts: LemlistGetAttempt[] = [];
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
        cache: "no-store"
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      attempts.push({ url, status: 0, preview: message });
      continue;
    }
    const raw = await res.text();
    attempts.push({ url, status: res.status, preview: raw.slice(0, 200) });
    if (!res.ok) continue;

    // 200 no garantiza que sea el API: una ruta inexistente de Lemlist cae
    // en el catch-all del SPA y devuelve el HTML de la web app con 200.
    // Solo aceptamos JSON real (objeto o array).
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("<")) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue; // no es JSON → no es la respuesta del API, probamos la próxima
    }
    if (!json || typeof json !== "object") continue;

    // Lemlist a veces devuelve el lead envuelto ({lead:{...}}, {data:{...}})
    // o como primer elemento de un array. Desenvolvemos antes de extraer.
    let parsed: LemlistLeadFetched = {};
    if (Array.isArray(json)) {
      parsed = (json[0] ?? {}) as LemlistLeadFetched;
    } else {
      const obj = json as Record<string, unknown>;
      if (obj.lead && typeof obj.lead === "object") {
        parsed = obj.lead as LemlistLeadFetched;
      } else if (obj.data && typeof obj.data === "object") {
        parsed = obj.data as LemlistLeadFetched;
      } else {
        parsed = obj as LemlistLeadFetched;
      }
    }
    return {
      ok: true,
      status: res.status,
      lead: parsed,
      phone: extractPhone(parsed),
      matched_url: url,
      raw: raw.slice(0, 1500),
      attempts
    };
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 0,
    error: `Lemlist GET failed on all ${attempts.length} URL pattern(s)`,
    debug: { attempts }
  };
}

// ============================================================================
// GET campaign leads — devuelve todos los leads de una campaña.
//
// Usado por el módulo /sales-navigator: el usuario manda perfiles de LinkedIn
// Sales Navigator a una campaña "puente" de Lemlist (con la extensión de
// Lemlist), y la app jala esos leads para pre-filtrarlos y mandarlos a la
// campaña real. La campaña puente NO tiene secuencia — es solo un buzón.
//
// Endpoint v1 documentado: GET /api/campaigns/{id}/leads (limit/offset).
// ============================================================================

export type LemlistCampaignLead = {
  id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
};

export type GetCampaignLeadsResult =
  | { ok: true; leads: LemlistCampaignLead[]; pages: number; matched_url: string }
  | { ok: false; status: number; error: string; debug?: unknown };

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function normalizeCampaignLead(raw: Record<string, unknown>): LemlistCampaignLead {
  return {
    id: pickStr(raw, ["_id", "id", "leadId"]),
    email: pickStr(raw, ["email", "Email"]),
    first_name: pickStr(raw, ["firstName", "first_name", "FirstName", "firstname"]),
    last_name: pickStr(raw, ["lastName", "last_name", "LastName", "lastname"]),
    company_name: pickStr(raw, [
      "companyName",
      "company_name",
      "company",
      "Company",
      "organizationName"
    ]),
    job_title: pickStr(raw, [
      "jobTitle",
      "job_title",
      "title",
      "Title",
      "position",
      "headline",
      "linkedinHeadline"
    ]),
    linkedin_url: pickStr(raw, [
      "linkedinUrl",
      "linkedin_url",
      "linkedin",
      "LinkedinUrl",
      "linkedInUrl"
    ])
  };
}

async function fetchLeadsPage(
  url: string
): Promise<{ ok: boolean; status: number; items: unknown[]; preview: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
      cache: "no-store"
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      items: [],
      preview: err instanceof Error ? err.message : "network error"
    };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, items: [], preview: text.slice(0, 300) };
  const trimmed = text.trim();
  // 200 con HTML del SPA de Lemlist = ruta inexistente; no es la respuesta del API.
  if (!trimmed || trimmed.startsWith("<")) {
    return {
      ok: false,
      status: res.status,
      items: [],
      preview: "non-JSON (SPA HTML?): " + trimmed.slice(0, 150)
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      status: res.status,
      items: [],
      preview: "non-JSON: " + trimmed.slice(0, 200)
    };
  }
  const p = parsed as Record<string, unknown>;
  const items = Array.isArray(parsed)
    ? (parsed as unknown[])
    : Array.isArray(p?.leads)
    ? (p.leads as unknown[])
    : Array.isArray(p?.data)
    ? (p.data as unknown[])
    : [];
  return { ok: true, status: res.status, items, preview: text.slice(0, 150) };
}

export async function getCampaignLeads(
  campaignId: string
): Promise<GetCampaignLeadsResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  }
  if (!campaignId) {
    return { ok: false, status: 500, error: "campaignId is empty" };
  }
  const id = encodeURIComponent(campaignId);
  const LIMIT = 100;
  const MAX_PAGES = 50;

  const patterns = [
    (offset: number) =>
      `${LEMLIST_API_BASE}/campaigns/${id}/leads?limit=${LIMIT}&offset=${offset}`,
    (offset: number) =>
      `${LEMLIST_API_BASE}/v2/campaigns/${id}/leads?limit=${LIMIT}&offset=${offset}`
  ];

  const attempts: LemlistGetAttempt[] = [];
  for (const p of patterns) {
    const first = await fetchLeadsPage(p(0));
    attempts.push({ url: p(0), status: first.status, preview: first.preview });
    if (!first.ok) continue;

    const all: LemlistCampaignLead[] = [];
    for (const it of first.items) {
      all.push(normalizeCampaignLead(it as Record<string, unknown>));
    }
    let offset = first.items.length;
    let pages = 1;
    let lastCount = first.items.length;
    while (lastCount === LIMIT && pages < MAX_PAGES) {
      const next = await fetchLeadsPage(p(offset));
      if (!next.ok) break;
      for (const it of next.items) {
        all.push(normalizeCampaignLead(it as Record<string, unknown>));
      }
      offset += next.items.length;
      lastCount = next.items.length;
      pages += 1;
    }
    return { ok: true, leads: all, pages, matched_url: p(0) };
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 0,
    error: `Lemlist GET campaign leads falló en todos los patrones (${attempts.length})`,
    debug: { attempts }
  };
}

// ============================================================================
// DELETE campaign lead — saca un lead de una campaña.
//
// Usado por la auto-limpieza de la Campaña puente: después de importar
// leads del módulo /sales-navigator, los borramos de la campaña puente
// en Lemlist para que la puente quede vacía entre empresas. Best-effort:
// si la DELETE falla, no rompe la importación (el contacto ya está en
// Supabase). Devolvemos el detalle de los intentos para diagnosticar.
//
// Probamos por email primero (más estable según docs v1) y por _id como
// fallback.
// ============================================================================

export type DeleteLeadResult =
  | { ok: true; status: number; matched_url: string }
  | { ok: false; status: number; error: string; debug?: unknown };

export async function deleteCampaignLead(
  campaignId: string,
  lead: { id?: string | null; email?: string | null }
): Promise<DeleteLeadResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  }
  if (!campaignId) {
    return { ok: false, status: 500, error: "campaignId is empty" };
  }
  if (!lead.id && !lead.email) {
    return { ok: false, status: 400, error: "lead needs id or email" };
  }
  const cid = encodeURIComponent(campaignId);
  const candidates: string[] = [];
  if (lead.email) {
    candidates.push(
      `${LEMLIST_API_BASE}/campaigns/${cid}/leads/${encodeURIComponent(lead.email)}`
    );
  }
  if (lead.id) {
    candidates.push(
      `${LEMLIST_API_BASE}/campaigns/${cid}/leads/${encodeURIComponent(lead.id)}`
    );
    // Algunas versiones aceptan /api/leads/{id} sin campaña — fallback.
    candidates.push(`${LEMLIST_API_BASE}/leads/${encodeURIComponent(lead.id)}`);
  }

  const attempts: { url: string; status: number; preview: string }[] = [];
  for (const url of candidates) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
        cache: "no-store"
      });
    } catch (err) {
      attempts.push({
        url,
        status: 0,
        preview: err instanceof Error ? err.message : "network error"
      });
      continue;
    }
    const text = await res.text();
    attempts.push({ url, status: res.status, preview: text.slice(0, 200) });
    if (res.ok) return { ok: true, status: res.status, matched_url: url };
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 0,
    error: `Lemlist DELETE falló en los ${attempts.length} intento(s)`,
    debug: { attempts }
  };
}
