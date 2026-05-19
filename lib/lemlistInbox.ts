// Cliente para la API de Inbox de Lemlist — Sprint 6 fase 3.
//
// Permite responder a un lead (LinkedIn o email) directamente desde el
// módulo /respuestas, sin entrar a Lemlist ni a LinkedIn. Lemlist manda el
// mensaje por la cuenta conectada del usuario.
//
// Endpoints (developer.lemlist.com → Inbox):
//   POST /api/inbox/linkedin    — enviar mensaje de LinkedIn
//   POST /api/inbox/email       — responder un email del hilo
//   GET  /api/inbox/{contactId} — traer el hilo completo (no usado todavía)
//
// El portal de docs de Lemlist bloquea fetch automático, así que el shape
// exacto del body de /inbox/email no está 100% confirmado. Igual que
// lib/lemlist.ts, probamos varios shapes/URLs y devolvemos `attempts` con
// el detalle de cada intento para diagnosticar desde la UI.
//
// Auth: Basic auth con usuario vacío + LEMLIST_API_KEY como password.

import {
  getLemlistLeadById,
  getLemlistLeadByEmail,
  type LemlistGetResult
} from "./lemlist";
import { getLemlistCampaignIds } from "./lemlistCampaigns";

const LEMLIST_API_BASE = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";

function buildAuthHeader(): string {
  const key = process.env.LEMLIST_API_KEY ?? "";
  return `Basic ${Buffer.from(`:${key}`).toString("base64")}`;
}

function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// ============================================================================
// Resolver sendUserId — el usuario de Lemlist cuya cuenta de LinkedIn / mailbox
// envía. Para un equipo chico suele ser uno solo. Camino confiable: env var
// LEMLIST_SEND_USER_ID. Fallback de conveniencia: GET /api/team.
// ============================================================================

export type SendUserResult =
  | { ok: true; sendUserId: string; source: string }
  | { ok: false; error: string; debug?: unknown };

export async function resolveSendUserId(): Promise<SendUserResult> {
  const envVal = (process.env.LEMLIST_SEND_USER_ID ?? "").trim();
  if (envVal) return { ok: true, sendUserId: envVal, source: "env" };

  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, error: "LEMLIST_API_KEY is not configured" };
  }

  // Fallback: intentar resolverlo desde el equipo de Lemlist.
  const url = `${LEMLIST_API_BASE}/team`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
      cache: "no-store"
    });
  } catch (err) {
    return {
      ok: false,
      error:
        "No se pudo resolver sendUserId (falló GET /api/team). Seteá LEMLIST_SEND_USER_ID en Vercel.",
      debug: { network: err instanceof Error ? err.message : "network error" }
    };
  }
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `No se pudo resolver sendUserId (GET /api/team → ${res.status}). Seteá LEMLIST_SEND_USER_ID en Vercel.`,
      debug: { status: res.status, preview: text.slice(0, 300) }
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error:
        "No se pudo resolver sendUserId (GET /api/team no devolvió JSON). Seteá LEMLIST_SEND_USER_ID en Vercel.",
      debug: { preview: text.slice(0, 300) }
    };
  }

  const obj = json as Record<string, unknown>;
  const users: unknown[] = Array.isArray((obj as { users?: unknown }).users)
    ? ((obj as { users: unknown[] }).users)
    : Array.isArray((obj as { members?: unknown }).members)
    ? ((obj as { members: unknown[] }).members)
    : Array.isArray(json)
    ? (json as unknown[])
    : [];
  const ids = users
    .map((u) => {
      const ur = u as Record<string, unknown>;
      return strOrNull(ur?._id) ?? strOrNull(ur?.id) ?? strOrNull(ur?.userId);
    })
    .filter(Boolean) as string[];

  if (ids.length === 1) return { ok: true, sendUserId: ids[0], source: "team" };
  if (ids.length > 1) {
    return {
      ok: false,
      error: `El equipo de Lemlist tiene ${ids.length} usuarios — no se puede elegir automáticamente. Seteá LEMLIST_SEND_USER_ID en Vercel con el ID del usuario que envía.`,
      debug: { user_ids: ids }
    };
  }
  return {
    ok: false,
    error: "No se pudo resolver sendUserId. Seteá LEMLIST_SEND_USER_ID en Vercel.",
    debug: { team_response: json }
  };
}

// ============================================================================
// Resolver leadId + contactId de Lemlist para una actividad de tipo reply.
// La tabla lemlist_activities ya guarda lead_id; contactId hay que sacarlo
// del payload crudo (raw) o, si no está, consultando el lead en Lemlist.
// ============================================================================

function idsFromRaw(raw: unknown): { leadId: string | null; contactId: string | null } {
  let leadId: string | null = null;
  let contactId: string | null = null;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, any>;
    leadId =
      strOrNull(r.leadId) ?? strOrNull(r._idLead) ?? strOrNull(r.lead_id) ?? null;
    if (!leadId && r.lead && typeof r.lead === "object") {
      leadId = strOrNull(r.lead._id) ?? strOrNull(r.lead.id) ?? null;
    }
    contactId =
      strOrNull(r.contactId) ??
      strOrNull(r._idContact) ??
      strOrNull(r.contact_id) ??
      null;
    if (!contactId && r.contact != null) {
      if (typeof r.contact === "string") contactId = strOrNull(r.contact);
      else if (typeof r.contact === "object") {
        contactId = strOrNull(r.contact._id) ?? strOrNull(r.contact.id) ?? null;
      }
    }
    if (!contactId && r.lead && typeof r.lead === "object") {
      contactId =
        strOrNull(r.lead.contactId) ?? strOrNull(r.lead._idContact) ?? null;
    }
  }
  return { leadId, contactId };
}

function contactIdFromLead(lead: Record<string, any>): string | null {
  const direct =
    strOrNull(lead.contactId) ??
    strOrNull(lead._idContact) ??
    strOrNull(lead.contact_id);
  if (direct) return direct;
  if (lead.contact != null) {
    if (typeof lead.contact === "string") return strOrNull(lead.contact);
    if (typeof lead.contact === "object") {
      return strOrNull(lead.contact._id) ?? strOrNull(lead.contact.id) ?? null;
    }
  }
  return null;
}

export type ResolvedInboxIds = {
  leadId: string | null;
  contactId: string | null;
  debug: Record<string, unknown>;
};

export async function resolveInboxIds(activity: {
  raw: unknown;
  lead_id: string | null;
  lead_email: string | null;
}): Promise<ResolvedInboxIds> {
  const fromRaw = idsFromRaw(activity.raw);
  let leadId = fromRaw.leadId ?? activity.lead_id ?? null;
  let contactId = fromRaw.contactId ?? null;
  const debug: Record<string, unknown> = {
    from_raw: fromRaw,
    stored_lead_id: activity.lead_id
  };

  // Si falta contactId (o leadId), consultamos el lead en Lemlist.
  if (!contactId || !leadId) {
    let lookup: LemlistGetResult | null = null;
    if (leadId) lookup = await getLemlistLeadById(leadId);
    if ((!lookup || !lookup.ok) && activity.lead_email) {
      // Probamos en cada campaña configurada — el lead puede estar en la
      // v1 vieja o en la v2 nueva (Email First).
      for (const cid of getLemlistCampaignIds()) {
        lookup = await getLemlistLeadByEmail(cid, activity.lead_email);
        if (lookup && lookup.ok) break;
      }
    }
    if (lookup && lookup.ok) {
      const lead = lookup.lead as Record<string, any>;
      leadId = leadId ?? strOrNull(lead._id) ?? strOrNull(lead.id);
      contactId = contactId ?? contactIdFromLead(lead);
      debug.lookup = {
        matched_url: lookup.matched_url,
        found_leadId: leadId,
        found_contactId: contactId
      };
    } else if (lookup) {
      debug.lookup = { ok: false, error: lookup.error };
    }
  }

  return { leadId, contactId, debug };
}

// ============================================================================
// Envío — POST a /api/inbox/linkedin y /api/inbox/email
// ============================================================================

type InboxAttempt = {
  url: string;
  method: string;
  body_shape: string;
  status: number;
  ok: boolean;
  response_preview: string;
};

export type InboxSendResult =
  | {
      ok: true;
      status: number;
      matched_url: string;
      body_shape: string;
      attempts: InboxAttempt[];
      raw: unknown;
    }
  | { ok: false; status: number; error: string; debug: { attempts: InboxAttempt[] } };

async function tryInboxRequest(
  url: string,
  payload: Record<string, unknown>,
  shape: string
): Promise<InboxAttempt & { parsed: unknown }> {
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
    return {
      url,
      method: "POST",
      body_shape: shape,
      status: 0,
      ok: false,
      response_preview: err instanceof Error ? err.message : "network error",
      parsed: null
    };
  }
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = { raw: raw.slice(0, 600) };
  }
  // Un 200 con HTML del SPA de Lemlist = ruta inexistente; no es éxito.
  const looksHtml = raw.trim().startsWith("<");
  return {
    url,
    method: "POST",
    body_shape: shape,
    status: res.status,
    ok: res.ok && !looksHtml,
    response_preview: raw.slice(0, 400),
    parsed
  };
}

async function runInboxCandidates(
  candidates: Array<{ url: string; payload: Record<string, unknown>; shape: string }>
): Promise<InboxSendResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return {
      ok: false,
      status: 500,
      error: "LEMLIST_API_KEY is not configured",
      debug: { attempts: [] }
    };
  }
  const attempts: InboxAttempt[] = [];
  for (const c of candidates) {
    const r = await tryInboxRequest(c.url, c.payload, c.shape);
    attempts.push({
      url: r.url,
      method: r.method,
      body_shape: r.body_shape,
      status: r.status,
      ok: r.ok,
      response_preview: r.response_preview
    });
    if (r.ok) {
      return {
        ok: true,
        status: r.status,
        matched_url: r.url,
        body_shape: r.body_shape,
        attempts,
        raw: r.parsed
      };
    }
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 0,
    error: `Lemlist Inbox rechazó el mensaje en los ${attempts.length} intento(s)`,
    debug: { attempts }
  };
}

export async function sendLinkedinMessage(p: {
  sendUserId: string;
  leadId: string;
  contactId: string;
  message: string;
}): Promise<InboxSendResult> {
  const base = {
    sendUserId: p.sendUserId,
    leadId: p.leadId,
    contactId: p.contactId,
    message: p.message
  };
  return runInboxCandidates([
    { url: `${LEMLIST_API_BASE}/inbox/linkedin`, payload: base, shape: "message" },
    { url: `${LEMLIST_API_BASE}/v2/inbox/linkedin`, payload: base, shape: "message" }
  ]);
}

export async function sendEmailReply(p: {
  sendUserId: string;
  leadId: string;
  contactId: string | null;
  message: string;
  subject?: string;
}): Promise<InboxSendResult> {
  const common: Record<string, unknown> = {
    sendUserId: p.sendUserId,
    leadId: p.leadId
  };
  if (p.contactId) common.contactId = p.contactId;
  if (p.subject && p.subject.trim()) common.subject = p.subject.trim();
  // El shape exacto del body de /inbox/email no está confirmado (el portal
  // de docs de Lemlist bloquea fetch). Probamos 'message' primero y luego
  // 'text'/'body' como fallback.
  return runInboxCandidates([
    {
      url: `${LEMLIST_API_BASE}/inbox/email`,
      payload: { ...common, message: p.message },
      shape: "message"
    },
    {
      url: `${LEMLIST_API_BASE}/inbox/email`,
      payload: { ...common, text: p.message, body: p.message },
      shape: "text+body"
    },
    {
      url: `${LEMLIST_API_BASE}/v2/inbox/email`,
      payload: { ...common, message: p.message },
      shape: "message"
    }
  ]);
}
