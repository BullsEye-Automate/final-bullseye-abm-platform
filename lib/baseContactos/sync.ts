import { supabaseAdmin } from "@/lib/supabase";
import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { listProperties } from "@/lib/radarAbm/server/hubspot";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { classifyPhone, countryFromText } from "./phones";
import { detectContactFields, LEMLIST_PHONE_FIELDS } from "@/lib/hubspotContactFields";

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
// Actualización semanal (pedido de BullsEye 25-nov-2026): una pasada nueva solo
// el domingo (hora de Chile) y solo con los contactos creados o modificados desde
// la pasada anterior (lastmodifieddate), así entran los contactos nuevos y los
// que recibieron teléfono. Una pasada sin terminar sigue cualquier día.
const PASS_EVERY_MS = 6 * 86400_000;
const isSundayInChile = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(new Date()) === "Sun";

// Campos de teléfono, correo y LinkedIn: todos los que existen para lo mismo
// (lib/hubspotContactFields.ts, revisados 27-nov-2026). HubSpot acepta hasta 5
// grupos de filtros por búsqueda, así que cada HubSpot se recorre en «carriles»
// de 5 campos de teléfono, cada uno con su propio avance (clave <fuente> y
// <fuente>#2, #3…). Un contacto que aparece en dos carriles se une una sola vez.
const LANE_SIZE = 5;
const BASE_PROPS = ["firstname", "lastname", "jobtitle", "company", "country", "createdate", "cliente_bullseye", "hs_email_hard_bounce_reason_enum", "telefono_central"];
// Subir este número obliga a una lectura completa (campos nuevos a leer)
const FIELDS_VERSION = 2;
type Fields = { phones: string[]; emails: string[]; linkedins: string[] };
const laneKey = (src: string, i: number) => (i ? `${src}#${i + 1}` : src);

const GENERIC_MAIL = /^(info|contacto|contact|ventas|sales|admin|hola|hello|rrhh|recepcion|reception|comercial|soporte|support|gerencia|finanzas|marketing|office|oficina)@/i;
const FREE_MAIL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|aol|protonmail|gmx|mail|yandex)\./i;

export type Source = { key: string; label: string; token?: string };
type SourceState = { cursor: string; done: boolean; count: number; error?: string | null; at?: string; fails?: number; lanes?: number };
export type SyncState = { passStartedAt: string | null; passFinishedAt: string | null; since?: string | null; v?: number; sources: Record<string, SourceState> };

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
type Quality = Record<string, { st?: string; calls?: number; at?: string } & Record<string, unknown>>;
type BaseRow = {
  person_key: string; name: string | null; title: string | null; company: string | null; company_domain: string | null;
  country: string | null; linkedin: string | null; email: string | null; emails: string[]; mobiles: string[];
  mobiles_maybe: string[]; clients: string[]; sources: SrcRef[]; synced_at: string;
  email_quality?: Record<string, { st: "malo"; why: string; src: string; at: string }>;
  phone_quality?: Quality; left_company?: unknown;
  aliases?: string[];   // claves anteriores de la misma persona (no se guarda)
};

// Una página de contactos de un HubSpot → filas de la base (sin unir aún)
function toRows(src: Source, results: { id: string; properties: Record<string, string | null> }[], clientLabels: Map<string, string>, f: Fields): BaseRow[] {
  const now = new Date().toISOString();
  return results.map((r) => {
    const p = r.properties ?? {};
    const hint = countryFromText(p.country);
    const mobiles: string[] = [], maybe: string[] = [];
    let country: string | null = hint;
    for (const k of f.phones) {
      // «Teléfono Central» = Sí: el campo Phone es la central de la empresa
      if (k === "phone" && p.telefono_central === "true") continue;
      const c = classifyPhone(p[k], hint);
      if (!c) continue;
      if (c.kind === "mobile") mobiles.push(c.number);
      else if (c.kind === "maybe") maybe.push(c.number);
      if (c.kind !== "other" && c.country) country = country ?? c.country;
    }
    const emails = uniq(f.emails.flatMap((k) => String(p[k] ?? "").split(/[;,\s]+/)).map(cleanEmail));
    const email = cleanEmail(p.email) ?? emails[0] ?? null;
    const li = f.linkedins.map((k) => linkedinSlug(p[k])).find(Boolean) ?? null;
    const hsKey = `hs:${src.key}:${r.id}`;
    const key = li ? `li:${li}` : email ? `em:${email}` : hsKey;
    // Si antes esta persona quedó con otra clave (sin LinkedIn o sin correo), se une
    // (los correos genéricos tipo contacto@ / ventas@ no, porque los comparten varias personas)
    const aliases = uniq([...(li ? emails.filter((e) => !GENERIC_MAIL.test(e)).map((e) => `em:${e}`) : []), hsKey]).filter((k) => k !== key);
    const name = [p.firstname, p.lastname].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || null;
    const clients = String(p.cliente_bullseye ?? "").split(";").map((v) => v.trim()).filter(Boolean).map((v) => clientLabels.get(v) ?? v);
    return {
      person_key: key, name, title: p.jobtitle?.trim() || null, company: p.company?.trim() || null,
      company_domain: corporateDomain(email), country, linkedin: li ? `https://www.linkedin.com/in/${li}` : null,
      email, emails, mobiles: uniq(mobiles), mobiles_maybe: uniq(maybe), clients: uniq(clients),
      ...(email && p.hs_email_hard_bounce_reason_enum ? { email_quality: { [email]: { st: "malo" as const, why: "Rebote duro en HubSpot", src: "hubspot", at: now } } } : {}),
      sources: [{ s: src.key, id: r.id, c: p.createdate ?? null, m: mobiles.length > 0, lp: LEMLIST_PHONE_FIELDS.some((k) => !!String(p[k] ?? "").replace(/\D/g, "")) }],
      synced_at: now, aliases,
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
    ...(a.email_quality || b.email_quality ? { email_quality: { ...(a.email_quality ?? {}), ...(b.email_quality ?? {}) } } : {}),
    ...(a.phone_quality || b.phone_quality ? { phone_quality: mergePhoneQuality(a.phone_quality, b.phone_quality) } : {}),
    ...(a.left_company || b.left_company ? { left_company: a.left_company ?? b.left_company } : {}),
    aliases: uniq([...(a.aliases ?? []), ...(b.aliases ?? [])]),
  };
}

// Calidad de un celular al unir dos filas: «malo» manda; si no, la con más llamadas
function mergePhoneQuality(a?: Quality, b?: Quality): Quality {
  const out: Quality = { ...(a ?? {}) };
  for (const [n, q] of Object.entries(b ?? {})) {
    const o = out[n];
    out[n] = !o ? q : o.st === "malo" ? o : q.st === "malo" ? q : (q.calls ?? 0) >= (o.calls ?? 0) ? q : o;
  }
  return out;
}

// La columna email_quality existe solo después de la migración de calidad
let qualityReady: boolean | null = null;
async function hasQualityColumns() {
  if (qualityReady === null) qualityReady = !(await supabaseAdmin().from("contact_base").select("email_quality").limit(1)).error;
  return qualityReady;
}

const COLS = "person_key, name, title, company, company_domain, country, linkedin, email, emails, mobiles, mobiles_maybe, clients, sources, synced_at";
async function selectByKeys(keys: string[], withQ: boolean): Promise<BaseRow[]> {
  const db = supabaseAdmin();
  const out: BaseRow[] = [];
  for (let i = 0; i < keys.length; i += 150) {
    const { data, error } = await db.from("contact_base").select(COLS + (withQ ? ", email_quality, phone_quality, left_company" : "")).in("person_key", keys.slice(i, i + 150));
    if (error) throw new Error(/does not exist|relation|schema cache|could not find the table/i.test(error.message) ? MIGRATION_HINT : error.message);
    out.push(...((data ?? []) as unknown as BaseRow[]));
  }
  return out;
}

async function upsertRows(rows: BaseRow[]) {
  const db = supabaseAdmin();
  const withQ = await hasQualityColumns();
  const byKey = new Map<string, BaseRow>();
  for (const r of rows) byKey.set(r.person_key, byKey.has(r.person_key) ? merge(byKey.get(r.person_key)!, r) : r);
  // Dentro de la misma página: una fila con clave anterior se une a la nueva
  for (const r of Array.from(byKey.values())) {
    for (const a of r.aliases ?? []) {
      const old = byKey.get(a);
      if (old && a !== r.person_key) { byKey.set(r.person_key, merge({ ...old, person_key: r.person_key }, byKey.get(r.person_key)!)); byKey.delete(a); }
    }
  }
  const aliasOf = new Map<string, string>();
  for (const r of Array.from(byKey.values())) for (const a of r.aliases ?? []) if (!byKey.has(a)) aliasOf.set(a, r.person_key);
  const existing = await selectByKeys([...Array.from(byKey.keys()), ...Array.from(aliasOf.keys())], withQ);
  const toDelete: string[] = [];
  // Primero lo guardado con la clave nueva, después lo guardado con claves anteriores
  for (const e of existing.filter((x) => byKey.has(x.person_key))) {
    byKey.set(e.person_key, merge({ ...e, sources: (e.sources ?? []) as SrcRef[] }, byKey.get(e.person_key)!));
  }
  for (const e of existing.filter((x) => aliasOf.has(x.person_key))) {
    const target = aliasOf.get(e.person_key)!;
    byKey.set(target, merge({ ...e, person_key: target, sources: (e.sources ?? []) as SrcRef[] }, byKey.get(target)!));
    toDelete.push(e.person_key);
  }
  // Todas las filas llevan las mismas columnas (si no, PostgREST deja en null las que faltan)
  const out = Array.from(byKey.values()).map((r) => {
    const { aliases: _a, email_quality, phone_quality, left_company, ...rest } = r;
    return withQ ? { ...rest, email_quality: email_quality ?? {}, phone_quality: phone_quality ?? {}, left_company: left_company ?? null } : rest;
  });
  // (la calidad guardada viene en el select, así que no se pierde)
  const { error: upErr } = await db.from("contact_base").upsert(out, { onConflict: "person_key" });
  if (upErr) throw new Error(upErr.message);
  for (let i = 0; i < toDelete.length; i += 150) await db.from("contact_base").delete().in("person_key", toDelete.slice(i, i + 150));
}

// Lee un HubSpot desde su cursor hasta el tiempo dado. Devuelve si terminó.
type SourceFields = { fields: Fields; wanted: string[]; clientLabels: Map<string, string> };
async function sourceFields(src: Source): Promise<SourceFields> {
  const props = await listProperties("contacts", src.token);
  const have = new Set(props.map((p) => p.name));
  const fields = detectContactFields(props);
  const wanted = Array.from(new Set([...BASE_PROPS.filter((p) => have.has(p)), ...fields.phones, ...fields.emails, ...fields.linkedins]));
  const cb = props.find((p) => p.name === "cliente_bullseye");
  return { fields, wanted, clientLabels: new Map((cb?.options ?? []).map((o) => [o.value, o.label])) };
}
const lanesOf = (f: Fields) => {
  const out: string[][] = [];
  for (let i = 0; i < f.phones.length; i += LANE_SIZE) out.push(f.phones.slice(i, i + LANE_SIZE));
  return out;
};

async function syncSource(src: Source, sf: SourceFields, filterProps: string[], st: SourceState, deadline: number, since: string | null): Promise<SourceState> {
  const { fields, wanted, clientLabels } = sf;
  if (!filterProps.length) return { ...st, done: true, error: "Sin propiedades de teléfono", at: new Date().toISOString() };
  let { cursor, count } = st;
  while (Date.now() < deadline) {
    const body = {
      filterGroups: filterProps.map((p) => ({ filters: [
        { propertyName: p, operator: "HAS_PROPERTY" },
        { propertyName: "hs_object_id", operator: "GT", value: cursor },
        ...(since ? [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(new Date(since).getTime()) }] : []),
      ] })),
      properties: wanted, limit: PAGE, sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
    };
    // HubSpot a veces responde 502/504 en búsquedas pesadas: se reintenta con página más chica
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await hsFetchWithRetry(`${HS}/crm/v3/objects/contacts/search`, { method: "POST", headers: hsHeaders(src.token), body: JSON.stringify(attempt ? { ...body, limit: 100 } : body) });
      if (res.ok || res.status < 500) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (!res!.ok) {
      const msg = `HubSpot ${res!.status}: ${(await res!.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`;
      // Se guarda el avance (cursor y conteo) y se sigue en el próximo tramo
      return { cursor, count, done: false, error: msg, at: new Date().toISOString(), fails: (st.fails ?? 0) + 1 };
    }
    const d = await res!.json();
    const results = (d.results ?? []) as { id: string; properties: Record<string, string | null> }[];
    if (!results.length) return { cursor, count, done: true, error: null, at: new Date().toISOString(), fails: 0 };
    await upsertRows(toRows(src, results, clientLabels, fields));
    count += results.length;
    cursor = results[results.length - 1].id;
    if (results.length < PAGE && results.length < 100) return { cursor, count, done: true, error: null, at: new Date().toISOString(), fails: 0 };
  }
  return { cursor, count, done: false, error: null, at: new Date().toISOString(), fails: 0 };
}

// Un HubSpot terminó cuando terminaron todos sus carriles
export function sourceDone(state: SyncState, key: string) {
  const main = state.sources[key] as SourceState | undefined;
  if (!main) return false;
  const n = main.lanes ?? 1;
  return Array.from({ length: n }, (_, i) => state.sources[laneKey(key, i)]?.done).every(Boolean);
}
export function sourceTotals(state: SyncState, key: string) {
  const main = state.sources[key] as SourceState | undefined;
  const n = main?.lanes ?? 1;
  const lanes = Array.from({ length: n }, (_, i) => state.sources[laneKey(key, i)]).filter(Boolean) as SourceState[];
  return { count: lanes.reduce((a, l) => a + (l.count ?? 0), 0), done: sourceDone(state, key), error: lanes.find((l) => l.error)?.error ?? null };
}

// Un tramo de la sincronización (cron o botón). force = empezar una pasada nueva.
export async function syncChunk(opts: { budgetMs?: number; force?: boolean } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const sources = await listSources();
  let state = await readState();
  const finishedRecently = state.passFinishedAt && Date.now() - new Date(state.passFinishedAt).getTime() < PASS_EVERY_MS;
  if (opts.force || !state.passStartedAt || (state.v ?? 1) < FIELDS_VERSION) {
    // Lectura completa (primera vez, forzada o con campos nuevos que leer)
    state = { passStartedAt: new Date().toISOString(), passFinishedAt: null, since: null, v: FIELDS_VERSION, sources: {} };
  } else if (state.passFinishedAt) {
    if (finishedRecently || !isSundayInChile()) return { skipped: true, state };
    // Domingo: solo lo creado o modificado desde el inicio de la pasada anterior (1 h de margen)
    const since = new Date(new Date(state.passStartedAt).getTime() - 3600_000).toISOString();
    state = { passStartedAt: new Date().toISOString(), passFinishedAt: null, since, v: FIELDS_VERSION, sources: {} };
  }
  // Carriles de cada HubSpot (5 campos de teléfono por carril); un HubSpot que no responde queda con error
  const plan: { src: Source; key: string; sf?: SourceFields; props: string[]; err?: string }[] = [];
  for (const src of sources) {
    if (sourceDone(state, src.key)) continue;
    if (Date.now() > deadline) break;
    try {
      const sf = await sourceFields(src);
      const lanes = lanesOf(sf.fields);
      if (!lanes.length) { plan.push({ src, key: src.key, sf, props: [] }); continue; }
      lanes.forEach((props, i) => plan.push({ src, key: laneKey(src.key, i), sf, props }));
      (state.sources[src.key] ??= { cursor: "0", done: false, count: 0 }).lanes = lanes.length;
    } catch (e) {
      plan.push({ src, key: src.key, props: [], err: (e as Error).message.slice(0, 300) });
    }
  }
  for (const { src, key, sf, props, err } of plan) {
    const st = state.sources[key] ?? { cursor: "0", done: false, count: 0 };
    if (st.done) continue;
    if (err) { state.sources[key] = { ...st, done: true, error: err, at: new Date().toISOString() }; continue; }
    if (Date.now() > deadline) break;
    try {
      const next = await syncSource(src, sf!, props, st, deadline, state.since ?? null);
      if (key === src.key) next.lanes = state.sources[key]?.lanes;
      // Tras 5 tramos seguidos con error se da por terminado ese HubSpot (queda el motivo)
      if (!next.done && (next.fails ?? 0) >= 5) next.done = true;
      state.sources[key] = next;
      if (next.error && !next.done) { await saveState(state); continue; }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === MIGRATION_HINT) throw e;
      state.sources[key] = { ...st, done: true, error: msg.slice(0, 300), at: new Date().toISOString() };
    }
    await saveState(state);
  }
  const allDone = sources.every((s) => sourceDone(state, s.key));
  if (allDone && !state.passFinishedAt) state.passFinishedAt = new Date().toISOString();
  await saveState(state);
  return { skipped: false, done: allDone, state, sources: sources.map((s) => ({ key: s.key, label: s.label })) };
}
