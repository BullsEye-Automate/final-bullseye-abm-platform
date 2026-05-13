// Cliente HubSpot Calls API. Sprint 5 fase 2.
//
// HubSpot guarda las llamadas como engagements del tipo "calls" (CRM object
// dedicado a partir de v3). Las propiedades relevantes son:
//   hs_timestamp                — fecha/hora de la llamada (ms epoch)
//   hs_call_direction           — INBOUND | OUTBOUND
//   hs_call_duration            — duración en ms
//   hs_call_status              — COMPLETED, IN_PROGRESS, CANCELED, FAILED, NO_ANSWER, BUSY, QUEUED, RINGING, MISSED
//   hs_call_disposition         — GUID que mapea a label vía /crm/v3/properties/calls/hs_call_disposition
//   hs_call_title               — título de la llamada
//   hs_call_body                — notas del SDR (HTML/texto)
//   hs_call_recording_url       — URL de la grabación (si la hay)
//   hs_call_transcription       — texto de la transcripción (si HubSpot la generó)
//   hubspot_owner_id            — owner que registró/hizo la llamada
//
// Associations: pedimos contacts y companies asociados para reconciliar
// con nuestra tabla contacts/companies por hubspot_contact_id /
// hubspot_company_id (poblados durante el push App → HubSpot).

const HUBSPOT_API_BASE = "https://api.hubapi.com";

const CALL_PROPERTIES = [
  "hs_timestamp",
  "hs_call_direction",
  "hs_call_duration",
  "hs_call_status",
  "hs_call_disposition",
  "hs_call_title",
  "hs_call_body",
  "hs_call_recording_url",
  "hs_call_transcription",
  "hubspot_owner_id"
];

type HubSpotApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; debug?: unknown };

function authHeaders(): Record<string, string> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function hubspotFetch<T = unknown>(
  path: string,
  init: RequestInit
): Promise<HubSpotApiResult<T>> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: false, status: 500, error: "HUBSPOT_ACCESS_TOKEN is not configured" };
  }
  const url = `${HUBSPOT_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 502, error: message, debug: { url } };
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
      error: `HubSpot ${res.status}`,
      debug: { url, method: init.method, response: parsed }
    };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

export type HubSpotCall = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
};

type SearchResponse = {
  total: number;
  results: HubSpotCall[];
  paging?: { next?: { after: string } };
};

// Busca calls posteriores a `sinceMs` (epoch ms). Iteramos paging hasta agotar
// el rango o llegar al `maxResults`. Devuelve calls ordenadas DESC por
// timestamp.
export async function searchCallsSince(
  sinceMs: number,
  maxResults = 200
): Promise<HubSpotApiResult<HubSpotCall[]>> {
  const out: HubSpotCall[] = [];
  let after: string | undefined;
  while (out.length < maxResults) {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_timestamp", operator: "GTE", value: String(sinceMs) }
          ]
        }
      ],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      properties: CALL_PROPERTIES,
      limit: Math.min(100, maxResults - out.length)
    };
    if (after) body.after = after;
    const res = await hubspotFetch<SearchResponse>("/crm/v3/objects/calls/search", {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) return res;
    out.push(...res.data.results);
    const next = res.data.paging?.next?.after;
    if (!next) break;
    after = next;
  }
  return { ok: true, status: 200, data: out };
}

// Pide associations en lote. La search API no devuelve associations por
// default, así que para los calls que nos importan hacemos un fetch de
// detail por id. Hacemos batch read para minimizar requests.
export async function batchReadCallAssociations(
  callIds: string[]
): Promise<HubSpotApiResult<HubSpotCall[]>> {
  if (callIds.length === 0) return { ok: true, status: 200, data: [] };
  const all: HubSpotCall[] = [];
  // El batch read endpoint acepta hasta 100 ids por llamada.
  for (let i = 0; i < callIds.length; i += 100) {
    const chunk = callIds.slice(i, i + 100);
    const res = await hubspotFetch<{ results: HubSpotCall[] }>(
      "/crm/v3/objects/calls/batch/read?associations=contacts,companies",
      {
        method: "POST",
        body: JSON.stringify({
          properties: CALL_PROPERTIES,
          inputs: chunk.map((id) => ({ id }))
        })
      }
    );
    if (!res.ok) return res;
    all.push(...(res.data.results ?? []));
  }
  return { ok: true, status: 200, data: all };
}

// Devuelve el mapa { id → label } de hs_call_disposition (las opciones que
// HubSpot tiene definidas para outcome de llamada: connected, no answer,
// left voicemail, etc.). Se llama una vez por sync y se cachea en memoria.
let _dispositionCache: Record<string, string> | null = null;
let _dispositionCacheAt = 0;

export async function getDispositionMap(): Promise<HubSpotApiResult<Record<string, string>>> {
  const TTL_MS = 10 * 60 * 1000;
  if (_dispositionCache && Date.now() - _dispositionCacheAt < TTL_MS) {
    return { ok: true, status: 200, data: _dispositionCache };
  }
  const res = await hubspotFetch<{ options?: Array<{ value: string; label: string }> }>(
    "/crm/v3/properties/calls/hs_call_disposition",
    { method: "GET" }
  );
  if (!res.ok) return res;
  const map: Record<string, string> = {};
  for (const opt of res.data.options ?? []) {
    map[opt.value] = opt.label;
  }
  _dispositionCache = map;
  _dispositionCacheAt = Date.now();
  return { ok: true, status: 200, data: map };
}

// Devuelve nombre del owner. Cache en memoria. HubSpot Owners API.
let _ownerCache: Record<string, string> | null = null;
let _ownerCacheAt = 0;

export async function getOwnerMap(): Promise<HubSpotApiResult<Record<string, string>>> {
  const TTL_MS = 10 * 60 * 1000;
  if (_ownerCache && Date.now() - _ownerCacheAt < TTL_MS) {
    return { ok: true, status: 200, data: _ownerCache };
  }
  const res = await hubspotFetch<{
    results: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
  }>("/crm/v3/owners?limit=100", { method: "GET" });
  if (!res.ok) return res;
  const map: Record<string, string> = {};
  for (const o of res.data.results ?? []) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || o.id;
    map[o.id] = name;
  }
  _ownerCache = map;
  _ownerCacheAt = Date.now();
  return { ok: true, status: 200, data: map };
}
