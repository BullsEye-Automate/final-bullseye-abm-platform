import { supabaseAdmin } from "@/lib/supabase";
import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { listProperties } from "@/lib/radarAbm/server/hubspot";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { classifyPhone, countryFromText } from "./phones";

// Base de contactos central (Centro de prospección → Base de contactos,
// pedido de BullsEye 25-nov-2026, reunión «Lemlist 2027»): junta en la tabla
// contact_base los contactos con teléfono de todos los HubSpot (el de BullsEye
// y los propios de los clientes), una fila por persona, para no volver a
// revelar en Lemlist celulares y correos que ya tenemos. Solo lectura en
// HubSpot. Se recorre cada HubSpot por id ascendente (filtro hs_object_id > cursor,
// así no hay tope de 10.000 resultados) y el avance queda en allo_response_cache.

const HS = "https://api.hubapi.com";
export const MIGRATION_HINT = "Falta ejecutar la migración supabase/20261125_contact_base_migration.sql en Supabase.";
const STATE_KEY = "base_contactos:state";
const PAGE = 200;
const PASS_EVERY_MS = 18 * 3600_000;

// Campos de teléfono (los mismos de Calidad de carga). HubSpot acepta hasta 5
// grupos de filtros: se usan los 5 que más traen teléfonos.
const PHONE_PROPS = ["mobilephone", "phone", "telefono_lemlist", "bullseye_telefono_lusha", "bullseye_telefono_clay", "phone_4", "hs_whatsapp_phone_number"];
const FILTER_PROPS = PHONE_PROPS.slice(0, 5);
const BASE_PROPS = ["firstname", "lastname", "jobtitle", "company", "email", "hs_linkedin_url", "country", "createdate", "cliente_bullseye"];

const FREE_MAIL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|aol|protonmail|gmx|mail|yandex)\./i;

export type Source = { key: string; label: string; token?: string };
type SourceState = { cursor: string; done: boolean; count: number; error?: string | null; at?: string };
export type SyncState = { passStartedAt: string | null; passFinishedAt: string | null; sources: Record<string, SourceState> };

export async function readState(): Promise<SyncState> {
  return (await readMonthCache<SyncState>(STATE_KEY)) ?? { passStartedAt: null, passFinishedAt: null, sources: {} };
}
const saveState = (s: SyncState) => writeMonthCache(STATE_KEY, s, 60 * 86400_000);

// HubSpot de BullsEye + cada HubSpot propio de un cliente (un token se lee una sola vez)
export async function listSources(): Promise<Source[]> {
  const db = supabaseAdmin();
  const [{ data: cfgs }, { data: clients }] = await Promise.all([
    db.from("client_configs").select("client_id, hubspot_access_token").not("hubspot_access_token", "is", null),
    db.from("clients").select("id, name"),
  ]);
  const name = new Map(((clients ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const out: Source[] = [{ key: "bullseye", label: "HubSpot de BullsEye" }];
  const seen = new Map<string, Source>();
  for (const c of (cfgs ?? []) as { client_id: string; hubspot_access_token: string | null }[]) {
    const t = (c.hubspot_access_token ?? "").trim();
    if (!t) continue;
    const prev = seen.get(t);
    if (prev) { prev.label += ` / ${name.get(c.client_id) ?? c.client_id}`; continue; }
    const s = { key: `c:${c.client_id}`, label: `HubSpot de ${name.get(c.client_id) ?? c.client_id}`, token: t };
    seen.set(t, s);
    out.push(s);
  }
  return out;
}

export function linkedinSlug(url: string | null | undefined): string | null {
  const m = String(url ?? "").match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ""); } catch { return m[1].toLowerCase(); }
}
const cleanEmail = (e: string | null | undefined) => {
  const s = String(e ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null;
};
export const corporateDomain = (email: string | null) => {
  const d = email?.split("@")[1] ?? null;
  return d && !FREE_MAIL.test(d) ? d : null;
};
const uniq = (a: (string | null | undefined)[]) => Array.from(new Set(a.filter((x): x is string => !!x)));

type SrcRef = { s: string; id: string; c: string | null; m: boolean; lp: boolean };
type BaseRow = {
  person_key: string; name: string | null; title: string | null; company: string | null; company_domain: string | null;
  country: string | null; linkedin: string | null; email: string | null; emails: string[]; mobiles: string[];
  mobiles_maybe: string[]; clients: string[]; sources: SrcRef[]; synced_at: string;
};

// Una página de contactos de un HubSpot → filas de la base (sin unir aún)
function toRows(src: Source, results: { id: string; properties: Record<string, string | null> }[], clientLabels: Map<string, string>): BaseRow[] {
  const now = new Date().toISOString();
  return results.map((r) => {
    const p = r.properties ?? {};
    const hint = countryFromText(p.country);
    const mobiles: string[] = [], maybe: string[] = [];
    let country: string | null = hint;
    for (const k of PHONE_PROPS) {
      const c = classifyPhone(p[k], hint);
      if (!c) continue;
      if (c.kind === "mobile") mobiles.push(c.number);
      else if (c.kind === "maybe") maybe.push(c.number);
      if (c.kind !== "other" && c.country) country = country ?? c.country;
    }
    const email = cleanEmail(p.email);
    const li = linkedinSlug(p.hs_linkedin_url);
    const key = li ? `li:${li}` : email ? `em:${email}` : `hs:${src.key}:${r.id}`;
    const name = [p.firstname, p.lastname].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || null;
    const clients = String(p.cliente_bullseye ?? "").split(";").map((v) => v.trim()).filter(Boolean).map((v) => clientLabels.get(v) ?? v);
    return {
      person_key: key, name, title: p.jobtitle?.trim() || null, company: p.company?.trim() || null,
      company_domain: corporateDomain(email), country, linkedin: li ? `https://www.linkedin.com/in/${li}` : null,
      email, emails: uniq([email]), mobiles: uniq(mobiles), mobiles_maybe: uniq(maybe), clients: uniq(clients),
      sources: [{ s: src.key, id: r.id, c: p.createdate ?? null, m: mobiles.length > 0, lp: !!String(p.telefono_lemlist ?? "").replace(/\D/g, "") }],
      synced_at: now,
    };
  });
}

// Une dos filas de la misma persona: los datos más nuevos completan, nunca borran
function merge(a: BaseRow, b: BaseRow): BaseRow {
  const sources = [...a.sources.filter((x) => !b.sources.some((y) => y.s === x.s && y.id === x.id)), ...b.sources];
  return {
    person_key: a.person_key, name: b.name ?? a.name, title: b.title ?? a.title, company: b.company ?? a.company,
    company_domain: b.company_domain ?? a.company_domain, country: a.country ?? b.country, linkedin: a.linkedin ?? b.linkedin,
    email: b.email ?? a.email, emails: uniq([...a.emails, ...b.emails]), mobiles: uniq([...a.mobiles, ...b.mobiles]),
    mobiles_maybe: uniq([...a.mobiles_maybe, ...b.mobiles_maybe]), clients: uniq([...a.clients, ...b.clients]),
    sources, synced_at: b.synced_at,
  };
}

async function upsertRows(rows: BaseRow[]) {
  const db = supabaseAdmin();
  const byKey = new Map<string, BaseRow>();
  for (const r of rows) byKey.set(r.person_key, byKey.has(r.person_key) ? merge(byKey.get(r.person_key)!, r) : r);
  const keys = Array.from(byKey.keys());
  const { data: existing, error } = await db.from("contact_base").select("*").in("person_key", keys);
  if (error) throw new Error(/does not exist|relation/i.test(error.message) ? MIGRATION_HINT : error.message);
  for (const e of (existing ?? []) as BaseRow[]) {
    const n = byKey.get(e.person_key);
    if (n) byKey.set(e.person_key, merge({ ...e, sources: (e.sources ?? []) as SrcRef[] }, n));
  }
  const { error: upErr } = await db.from("contact_base").upsert(Array.from(byKey.values()), { onConflict: "person_key" });
  if (upErr) throw new Error(upErr.message);
}

// Lee un HubSpot desde su cursor hasta el tiempo dado. Devuelve si terminó.
async function syncSource(src: Source, st: SourceState, deadline: number): Promise<SourceState> {
  const props = await listProperties("contacts", src.token);
  const have = new Set(props.map((p) => p.name));
  const filterProps = FILTER_PROPS.filter((p) => have.has(p));
  if (!filterProps.length) return { ...st, done: true, error: "Sin propiedades de teléfono", at: new Date().toISOString() };
  const wanted = [...BASE_PROPS, ...PHONE_PROPS].filter((p) => have.has(p));
  const cb = props.find((p) => p.name === "cliente_bullseye");
  const clientLabels = new Map((cb?.options ?? []).map((o) => [o.value, o.label]));
  let { cursor, count } = st;
  while (Date.now() < deadline) {
    const body = {
      filterGroups: filterProps.map((p) => ({ filters: [{ propertyName: p, operator: "HAS_PROPERTY" }, { propertyName: "hs_object_id", operator: "GT", value: cursor }] })),
      properties: wanted, limit: PAGE, sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
    };
    const res = await hsFetchWithRetry(`${HS}/crm/v3/objects/contacts/search`, { method: "POST", headers: hsHeaders(src.token), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const d = await res.json();
    const results = (d.results ?? []) as { id: string; properties: Record<string, string | null> }[];
    if (!results.length) return { cursor, count, done: true, error: null, at: new Date().toISOString() };
    await upsertRows(toRows(src, results, clientLabels));
    count += results.length;
    cursor = results[results.length - 1].id;
    if (results.length < PAGE) return { cursor, count, done: true, error: null, at: new Date().toISOString() };
  }
  return { cursor, count, done: false, error: null, at: new Date().toISOString() };
}

// Un tramo de la sincronización (cron o botón). force = empezar una pasada nueva.
export async function syncChunk(opts: { budgetMs?: number; force?: boolean } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const sources = await listSources();
  let state = await readState();
  const finishedRecently = state.passFinishedAt && Date.now() - new Date(state.passFinishedAt).getTime() < PASS_EVERY_MS;
  if (opts.force || !state.passStartedAt || (state.passFinishedAt && !finishedRecently)) {
    state = { passStartedAt: new Date().toISOString(), passFinishedAt: null, sources: {} };
  } else if (finishedRecently) {
    return { skipped: true, state };
  }
  for (const src of sources) {
    const st = state.sources[src.key] ?? { cursor: "0", done: false, count: 0 };
    if (st.done) continue;
    if (Date.now() > deadline) break;
    try {
      state.sources[src.key] = await syncSource(src, st, deadline);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === MIGRATION_HINT) throw e;
      state.sources[src.key] = { ...st, done: true, error: msg.slice(0, 300), at: new Date().toISOString() };
    }
    await saveState(state);
  }
  const allDone = sources.every((s) => state.sources[s.key]?.done);
  if (allDone && !state.passFinishedAt) state.passFinishedAt = new Date().toISOString();
  await saveState(state);
  return { skipped: false, done: allDone, state, sources: sources.map((s) => ({ key: s.key, label: s.label })) };
}
