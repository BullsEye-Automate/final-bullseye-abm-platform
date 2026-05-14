// Cliente + sync de actividades de Lemlist para el módulo Outreach (/campanas).
// Lemlist ejecuta la cadencia multicanal (LinkedIn + email). Su API v1
// /api/activities devuelve el feed de eventos de la campaña — lo pulleamos,
// lo matcheamos a nuestros contactos por email y lo guardamos en
// lemlist_activities para mostrar en qué paso de la cadencia está cada lead.
//
// Igual que lib/lemlist.ts, la API de Lemlist es inconsistente entre
// versiones: probamos patrones de URL y parseamos defensivo.

import type { SupabaseClient } from "@supabase/supabase-js";

const LEMLIST_API_BASE = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";

function buildAuthHeader(): string {
  const key = process.env.LEMLIST_API_KEY ?? "";
  return `Basic ${Buffer.from(`:${key}`).toString("base64")}`;
}

export type LemlistChannel = "email" | "linkedin" | "call" | "other";

export type LemlistActivity = {
  lemlist_activity_id: string;
  lead_email: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  channel: LemlistChannel;
  type: string;
  activity_at: string | null;
  raw: unknown;
};

function channelForType(type: string): LemlistChannel {
  const t = type.toLowerCase();
  if (t.startsWith("email")) return "email";
  if (t.startsWith("linkedin")) return "linkedin";
  if (t.startsWith("aircall") || t.includes("call")) return "call";
  return "other";
}

function pick(obj: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizeActivity(raw: Record<string, any>): LemlistActivity | null {
  const type = pick(raw, ["type", "activityType"]);
  if (!type || typeof type !== "string") return null;

  const leadEmail =
    pick(raw, ["leadEmail", "email"]) ??
    (raw.lead && typeof raw.lead === "object" ? raw.lead.email : undefined) ??
    null;
  const leadId =
    pick(raw, ["leadId", "_idLead", "lead_id"]) ??
    (raw.lead && typeof raw.lead === "object" ? raw.lead._id : undefined) ??
    null;
  const campaignId = pick(raw, ["campaignId", "campaign", "_idCampaign"]) ?? null;

  const dateRaw = pick(raw, ["date", "createdAt", "activityDate", "time", "updatedAt"]);
  let activity_at: string | null = null;
  if (dateRaw) {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) activity_at = d.toISOString();
  }

  const lemlistId = pick(raw, ["_id", "id"]);
  // Clave de dedup: el _id de Lemlist si existe; si no, una sintética
  // determinística para que re-sincronizar no duplique filas.
  const lemlist_activity_id = lemlistId
    ? String(lemlistId)
    : `${leadEmail ?? "noemail"}:${type}:${activity_at ?? "nodate"}`;

  return {
    lemlist_activity_id,
    lead_email: leadEmail ? String(leadEmail).toLowerCase() : null,
    lead_id: leadId ? String(leadId) : null,
    campaign_id: campaignId ? String(campaignId) : null,
    channel: channelForType(type),
    type,
    activity_at,
    raw
  };
}

async function fetchPage(
  url: string
): Promise<{ ok: boolean; status: number; items: any[]; preview: string }> {
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
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    return {
      ok: false,
      status: res.status,
      items: [],
      preview: "non-JSON response: " + text.slice(0, 200)
    };
  }
  // Lemlist puede devolver array directo o { activities|data: [...] }.
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.activities)
    ? parsed.activities
    : Array.isArray(parsed?.data)
    ? parsed.data
    : [];
  return { ok: true, status: res.status, items, preview: text.slice(0, 200) };
}

export type FetchActivitiesResult = {
  ok: boolean;
  activities: LemlistActivity[];
  pages: number;
  error?: string;
  debug?: unknown;
};

export async function fetchCampaignActivities(
  campaignId: string
): Promise<FetchActivitiesResult> {
  if (!process.env.LEMLIST_API_KEY) {
    return { ok: false, activities: [], pages: 0, error: "LEMLIST_API_KEY is not configured" };
  }
  const id = encodeURIComponent(campaignId);
  const LIMIT = 100;
  const MAX_PAGES = 50;

  // Patrones de URL a probar para la primera página; nos quedamos con el
  // que responda 2xx para paginar el resto.
  const patterns = [
    (offset: number) =>
      `${LEMLIST_API_BASE}/activities?campaignId=${id}&limit=${LIMIT}&offset=${offset}`,
    (offset: number) =>
      `${LEMLIST_API_BASE}/v2/activities?campaignId=${id}&limit=${LIMIT}&offset=${offset}`
  ];

  const attempts: { url: string; status: number; preview: string }[] = [];
  for (const p of patterns) {
    const first = await fetchPage(p(0));
    attempts.push({ url: p(0), status: first.status, preview: first.preview });
    if (!first.ok) continue;

    const all: LemlistActivity[] = [];
    const collect = (items: any[]) => {
      for (const it of items) {
        const n = normalizeActivity(it as Record<string, any>);
        if (n) all.push(n);
      }
    };
    collect(first.items);

    let offset = first.items.length;
    let pages = 1;
    let lastCount = first.items.length;
    while (lastCount === LIMIT && pages < MAX_PAGES) {
      const next = await fetchPage(p(offset));
      if (!next.ok) break;
      collect(next.items);
      offset += next.items.length;
      lastCount = next.items.length;
      pages += 1;
    }
    return { ok: true, activities: all, pages };
  }

  return {
    ok: false,
    activities: [],
    pages: 0,
    error: `Lemlist /activities falló en todos los patrones (${attempts.length})`,
    debug: { attempts }
  };
}

// ============================================================================
// Sync — pull + match por email + upsert
// ============================================================================

export type SyncActivitiesResult = {
  ok: boolean;
  fetched: number;
  upserted: number;
  matched: number;
  pages?: number;
  error?: string;
  debug?: unknown;
};

export async function syncLemlistActivities(
  db: SupabaseClient
): Promise<SyncActivitiesResult> {
  const campaignId = process.env.LEMLIST_CAMPAIGN_ID;
  if (!campaignId) {
    return {
      ok: false,
      fetched: 0,
      upserted: 0,
      matched: 0,
      error: "LEMLIST_CAMPAIGN_ID is not configured"
    };
  }

  const fetched = await fetchCampaignActivities(campaignId);
  if (!fetched.ok) {
    return {
      ok: false,
      fetched: 0,
      upserted: 0,
      matched: 0,
      error: fetched.error,
      debug: fetched.debug
    };
  }

  // Mapa email → contact_id para matchear las actividades a nuestra DB.
  const { data: contactRows, error: cErr } = await db
    .from("contacts")
    .select("id, email")
    .not("email", "is", null);
  if (cErr) {
    return {
      ok: false,
      fetched: fetched.activities.length,
      upserted: 0,
      matched: 0,
      error: cErr.message
    };
  }
  const emailToId = new Map<string, string>();
  for (const r of contactRows ?? []) {
    if (r.email) emailToId.set(String(r.email).toLowerCase(), r.id as string);
  }

  let matched = 0;
  const rows = fetched.activities.map((a) => {
    const contact_id = a.lead_email ? emailToId.get(a.lead_email) ?? null : null;
    if (contact_id) matched += 1;
    return {
      lemlist_activity_id: a.lemlist_activity_id,
      contact_id,
      lead_email: a.lead_email,
      lead_id: a.lead_id,
      campaign_id: a.campaign_id,
      channel: a.channel,
      type: a.type,
      activity_at: a.activity_at,
      raw: a.raw
    };
  });

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await db
      .from("lemlist_activities")
      .upsert(slice, { onConflict: "lemlist_activity_id" });
    if (error) {
      return {
        ok: false,
        fetched: fetched.activities.length,
        upserted,
        matched,
        error: error.message
      };
    }
    upserted += slice.length;
  }

  return {
    ok: true,
    fetched: fetched.activities.length,
    upserted,
    matched,
    pages: fetched.pages
  };
}

// ============================================================================
// Derivación del estado de la cadencia por contacto
// ============================================================================

export const LINKEDIN_STEPS = ["not_started", "visited", "invited", "connected", "replied"] as const;
export const EMAIL_STEPS = ["not_started", "sent", "opened", "clicked", "replied"] as const;

export type LinkedinStep = (typeof LINKEDIN_STEPS)[number];
export type EmailStep = (typeof EMAIL_STEPS)[number];

export type OutreachState = {
  linkedin_step: LinkedinStep;
  email_step: EmailStep;
  replied: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  interested: boolean;
  last_activity_at: string | null;
  activity_count: number;
};

function linkedinStepForType(type: string): LinkedinStep | null {
  const t = type.toLowerCase();
  if (t.includes("replied") || t.includes("answer")) return "replied";
  if (t.includes("accepted") || t.includes("connect")) return "connected";
  if (t.includes("invite") || t.includes("send") || t.includes("sent")) return "invited";
  if (t.includes("visit")) return "visited";
  return null;
}

function emailStepForType(type: string): EmailStep | null {
  const t = type.toLowerCase();
  if (t.includes("replied")) return "replied";
  if (t.includes("clicked")) return "clicked";
  if (t.includes("opened")) return "opened";
  if (t.includes("sent")) return "sent";
  return null;
}

export function deriveOutreachState(
  acts: { type: string; channel: string | null; activity_at: string | null }[]
): OutreachState {
  let li = 0;
  let em = 0;
  let replied = false;
  let bounced = false;
  let unsubscribed = false;
  let interested = false;
  let last: string | null = null;

  for (const a of acts) {
    const t = a.type.toLowerCase();
    if (t.includes("replied") || t.includes("answer")) replied = true;
    if (t.includes("bounce")) bounced = true;
    if (t.includes("unsubscrib")) unsubscribed = true;
    if (t.includes("interested") && !t.includes("notinterested") && !t.includes("not_interested")) {
      interested = true;
    }
    if (a.channel === "linkedin") {
      const s = linkedinStepForType(a.type);
      if (s) li = Math.max(li, LINKEDIN_STEPS.indexOf(s));
    } else if (a.channel === "email") {
      const s = emailStepForType(a.type);
      if (s) em = Math.max(em, EMAIL_STEPS.indexOf(s));
    }
    if (a.activity_at && (!last || a.activity_at > last)) last = a.activity_at;
  }

  return {
    linkedin_step: LINKEDIN_STEPS[li],
    email_step: EMAIL_STEPS[em],
    replied,
    bounced,
    unsubscribed,
    interested,
    last_activity_at: last,
    activity_count: acts.length
  };
}
