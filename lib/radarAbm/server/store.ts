import { supabaseAdmin } from "@/lib/supabase";
import { mergeConfig, PER_CLIENT_KEYS } from "../dictionaries";
import type { RadarConfig, RadarDataset } from "../types";
import { parseSubs, subSlug } from "../subAccounts";

// Pulso ABM — lectura y escritura en Supabase (service role, solo servidor).
// Tablas en supabase/20261026_radar_abm_migration.sql.

export type RadarClientSettings = {
  client_id: string;
  hubspot_source: "bullseye" | "client";
  hubspot_client_value: string | null;
  deep: boolean | null;
  pipeline: boolean | null;
  portal_enabled: boolean;
  properties: Record<string, string>;   // mapeo propio (solo HubSpot del cliente)
};

export const DEFAULT_CLIENT_SETTINGS = (clientId: string): RadarClientSettings => ({
  client_id: clientId,
  hubspot_source: "bullseye",
  hubspot_client_value: null,
  deep: null,
  pipeline: null,
  portal_enabled: true,
  properties: {},
});

const missingTable = (msg: string) => /does not exist|relation .* not found|Could not find the table/i.test(msg);
export const MIGRATION_HINT = "Falta ejecutar la migración supabase/20261026_radar_abm_migration.sql en Supabase.";
const missingColumn = (msg: string) => /column .*properties|properties.*(does not exist|schema cache)/i.test(msg);
export const PROPERTIES_MIGRATION_HINT = "Falta ejecutar la migración supabase/20261027_radar_abm_client_properties.sql en Supabase.";

// Mapeo de propiedades que se usa para un cliente: el HubSpot de BullsEye usa
// el mapeo global más lo propio del cliente; el HubSpot propio del cliente,
// solo el suyo (los nombres internos de BullsEye no existen en su cuenta).
// En el HubSpot de BullsEye el status y el SDR de empresa y de contacto son
// propiedades por cliente: nunca se toman del mapeo global.
// Modo del universo: "status" (Status de la asignación, por defecto) o
// "client" (propiedad Cliente BullsEye). El cliente BullsEye usa "client".
// Reuniones = total de la planilla aunque haya filtros de empresa (wishlist,
// industria): solo se filtran por fechas, SDR y país, que la planilla sí
// tiene. Por ahora solo AcidLab (automático) o quien lo active en
// Configuración → Cliente → Pulso ABM.
export function meetingsTotal(s: { properties?: Record<string, string> }, clientName: string): boolean {
  const m = s.properties?.meetingsTotal;
  if (m === "si" || m === "no") return m === "si";
  return clientName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").startsWith("acidlab");
}

// Universo = solo empresas con la wishlist del cliente en "Sí". Automático
// para Nisum (una wishlist por mercado); configurable en Configuración →
// Cliente → Pulso ABM.
export function wishlistOnly(s: { properties?: Record<string, string> }, clientName: string): boolean {
  const m = s.properties?.wishlistOnly;
  if (m === "si" || m === "no") return m === "si";
  const c = clientName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Automático para Nisum y Crossnet (pedido de BullsEye)
  return /^(nisum|crossnet)/.test(c);
}

export function universeMode(s: { properties?: Record<string, string> }, clientName: string): "status" | "client" {
  const m = s.properties?.universeMode;
  if (m === "client" || m === "status") return m;
  return clientName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") === "bullseye" ? "client" : "status";
}

// Varios clientes dentro del mismo HubSpot (ej. Nisum Chile / Colombia / Perú
// y KI Technologies): uno por línea en Configuración → Cliente → Pulso ABM
export function subAccounts(s: { properties?: Record<string, string> }): string[] {
  return parseSubs(s.properties?.subAccounts);
}

// Propiedades elegidas a mano para un cliente de la cuenta: claves
// "sub:<slug>:<clave>" (ej. sub:nisumchile:companyStatus). Solo las por cliente.
export const SUB_KEYS = ["companyStatus", "companySdr", "contactStatus", "contactSdr", "companyWishlist"];
export const subKey = (sub: string, key: string) => `sub:${subSlug(sub)}:${key}`;
export function subMapping(cfg: RadarConfig, s: RadarClientSettings, sub: string): Record<string, string> {
  const base = Object.fromEntries(Object.entries(effectiveProperties(cfg, s)).filter(([k]) => !PER_CLIENT_KEYS.includes(k) && !k.startsWith("sub:")));
  for (const k of SUB_KEYS) { const v = (s.properties?.[subKey(sub, k)] ?? "").trim(); if (v) base[k] = v; }
  return base;
}

export function effectiveProperties(cfg: RadarConfig, s: RadarClientSettings): Record<string, string> {
  if (s.hubspot_source === "client") return { ...(s.properties ?? {}) };
  const global = Object.fromEntries(Object.entries(cfg.properties).filter(([k]) => !PER_CLIENT_KEYS.includes(k)));
  return { ...global, ...(s.properties ?? {}) };
}

export async function loadRadarConfig(): Promise<RadarConfig> {
  const { data, error } = await supabaseAdmin().from("radar_abm_config").select("config").eq("id", "global").maybeSingle();
  if (error && !missingTable(error.message)) throw new Error(error.message);
  return mergeConfig((data?.config ?? null) as Partial<RadarConfig> | null);
}

export async function saveRadarConfig(cfg: RadarConfig, by: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("radar_abm_config")
    .upsert({ id: "global", config: cfg, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(missingTable(error.message) ? MIGRATION_HINT : error.message);
}

export async function loadClientSettings(clientId: string): Promise<RadarClientSettings> {
  const { data, error } = await supabaseAdmin().from("radar_abm_clients").select("*").eq("client_id", clientId).maybeSingle();
  if (error && !missingTable(error.message)) throw new Error(error.message);
  return data ? { ...DEFAULT_CLIENT_SETTINGS(clientId), ...(data as RadarClientSettings) } : DEFAULT_CLIENT_SETTINGS(clientId);
}

export async function saveClientSettings(s: RadarClientSettings, by: string): Promise<void> {
  const row = { ...s, updated_by: by, updated_at: new Date().toISOString() };
  let { error } = await supabaseAdmin().from("radar_abm_clients").upsert(row, { onConflict: "client_id" });
  // Sin la columna properties (migración 20261027 pendiente) se puede seguir
  // guardando lo demás mientras no haya un mapeo propio que perder.
  if (error && missingColumn(error.message) && !Object.keys(s.properties ?? {}).length) {
    const { properties: _p, ...rest } = row;
    ({ error } = await supabaseAdmin().from("radar_abm_clients").upsert(rest, { onConflict: "client_id" }));
  }
  if (error) throw new Error(missingTable(error.message) ? MIGRATION_HINT : missingColumn(error.message) ? PROPERTIES_MIGRATION_HINT : error.message);
}

export type RadarSubSnapshot = { name: string; url: string; warnings: string[]; mapping?: RadarDataset["mapping"]; syncedAt: string | null };
export type RadarSnapshot = {
  dataset: RadarDataset;
  synced_at: string;
  warnings: string[];
  stats: Record<string, number>;
  datasetUrl?: string; // modo "url": el navegador descarga el informe desde Storage
  mapping?: RadarDataset["mapping"]; // modo "url": mapeo de propiedades (solo vista interna)
  subs?: RadarSubSnapshot[]; // modo "url": un informe por cliente de la cuenta (selector)
};

// El informe completo se guarda comprimido en Supabase Storage (con miles de
// contactos y actividades pesa varios MB: guardarlo en el jsonb daba
// "statement timeout" y no cabía en la respuesta de Vercel de 4,5 MB). En la
// fila queda una referencia + las empresas (id, nombre, dominio) para la
// exclusión de la wishlist y el mapeo de propiedades (solo uso interno: el
// archivo no lleva avisos ni mapeo, así el portal puede descargarlo tal cual).
// Con varios clientes en la cuenta (subAccounts) hay un archivo por cliente y
// la fila guarda la lista (subs).
const BUCKET = "radar-abm";
type SlimCompany = { id: string | number; n: string; dom?: string };
type StoredSub = { name: string; $storage: string; mapping?: RadarDataset["mapping"]; syncedAt: string | null; stats: Record<string, number>; warnings: string[]; companies: SlimCompany[] };
type StoredRef = {
  $storage: string;
  mapping?: RadarDataset["mapping"];
  client: { companies: SlimCompany[] };
  subs?: StoredSub[];
};
const isRef = (d: unknown): d is StoredRef => !!d && typeof (d as StoredRef).$storage === "string";

async function ensureBucket() {
  const { error } = await supabaseAdmin().storage.createBucket(BUCKET, { public: false });
  if (error && !/exist/i.test(error.message)) throw new Error(`No se pudo crear el bucket ${BUCKET}: ${error.message}`);
}

async function downloadDataset(path: string): Promise<RadarDataset> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`No se pudo leer el informe guardado: ${error?.message ?? "sin datos"}`);
  const { gunzipSync } = await import("zlib");
  return JSON.parse(gunzipSync(Buffer.from(await data.arrayBuffer())).toString("utf8")) as RadarDataset;
}

async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`No se pudo preparar el informe: ${error?.message ?? "sin link"}`);
  return data.signedUrl;
}

// mode: "full" = informe completo (servidor), "url" = link firmado para que lo
// descargue el navegador, "meta" = solo fecha, avisos y conteos
export async function loadSnapshot(clientId: string, mode: "full" | "url" | "meta" = "full"): Promise<RadarSnapshot | null> {
  const { data, error } = await supabaseAdmin()
    .from("radar_abm_snapshots")
    .select(mode === "meta" ? "synced_at, warnings, stats" : "dataset, synced_at, warnings, stats")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error && !missingTable(error.message)) throw new Error(error.message);
  const snap = (data as unknown as (Omit<RadarSnapshot, "dataset"> & { dataset?: unknown }) | null) ?? null;
  if (!snap || mode === "meta" || !isRef(snap.dataset)) return snap as RadarSnapshot | null;
  const ref = snap.dataset;
  if (mode === "url") {
    if (ref.subs?.length) {
      const urls = await Promise.all(ref.subs.map((x) => signedUrl(x.$storage)));
      const subs = ref.subs.map((x, i) => ({ name: x.name, url: urls[i], warnings: x.warnings ?? [], ...(x.mapping ? { mapping: x.mapping } : {}), syncedAt: x.syncedAt }));
      return { ...snap, dataset: null as unknown as RadarDataset, datasetUrl: urls[0], warnings: subs[0].warnings, ...(subs[0].mapping ? { mapping: subs[0].mapping } : {}), subs };
    }
    return { ...snap, dataset: null as unknown as RadarDataset, datasetUrl: await signedUrl(ref.$storage), ...(ref.mapping ? { mapping: ref.mapping } : {}) };
  }
  const first = ref.subs?.[0];
  const ds = await downloadDataset(first ? first.$storage : ref.$storage);
  const mapping = first ? first.mapping : ref.mapping;
  return { ...snap, dataset: { ...ds, warnings: (first ? first.warnings : snap.warnings) ?? [], ...(mapping ? { mapping } : {}) } };
}

// Todos los informes guardados del cliente (uno por cuenta si el HubSpot
// tiene varios clientes), completos. Lo usan los cálculos de servidor que
// recorren todas las cuentas (ej. Devoluciones en Células SDR).
export async function loadAllDatasets(clientId: string): Promise<{ sub?: string; dataset: RadarDataset; syncedAt: string | null }[]> {
  const { data, error } = await supabaseAdmin().from("radar_abm_snapshots").select("dataset, synced_at").eq("client_id", clientId).maybeSingle();
  if (error && !missingTable(error.message)) throw new Error(error.message);
  if (!data) return [];
  const ref = data.dataset as unknown;
  if (!isRef(ref)) return ref ? [{ dataset: ref as RadarDataset, syncedAt: (data.synced_at as string) ?? null }] : [];
  if (ref.subs?.length) {
    const out: { sub?: string; dataset: RadarDataset; syncedAt: string | null }[] = [];
    for (const x of ref.subs) out.push({ sub: x.name, dataset: await downloadDataset(x.$storage), syncedAt: x.syncedAt });
    return out;
  }
  return [{ dataset: await downloadDataset(ref.$storage), syncedAt: (data.synced_at as string) ?? null }];
}

// sub: cliente de la cuenta (subAccounts); order: orden configurado de las cuentas
export async function saveSnapshot(clientId: string, ds: RadarDataset, stats: Record<string, number>, by: string, sub?: string, order: string[] = []): Promise<void> {
  const { warnings, mapping, ...file } = ds;
  await ensureBucket();
  const { gzipSync } = await import("zlib");
  const path = sub ? `${clientId}/${subSlug(sub)}.json.gz` : `${clientId}.json.gz`;
  const { error: upErr } = await supabaseAdmin().storage.from(BUCKET)
    .upload(path, gzipSync(Buffer.from(JSON.stringify(file), "utf8")), { contentType: "application/gzip", upsert: true });
  if (upErr) throw new Error(`No se pudo guardar el informe en Storage: ${upErr.message}`);
  const companies: SlimCompany[] = ds.client.companies.map((c) => ({ id: c.id, n: c.n, ...(c.dom ? { dom: c.dom } : {}) }));
  let ref: StoredRef;
  if (sub) {
    const { data: prev } = await supabaseAdmin().from("radar_abm_snapshots").select("dataset").eq("client_id", clientId).maybeSingle();
    const prevSubs = isRef(prev?.dataset) ? (prev!.dataset as StoredRef).subs ?? [] : [];
    const entry: StoredSub = { name: sub, $storage: path, ...(mapping ? { mapping } : {}), syncedAt: ds.syncedAt ?? new Date().toISOString(), stats, warnings: warnings ?? [], companies };
    const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? 99 : i; };
    // Solo las cuentas que siguen configuradas
    const subs = [...prevSubs.filter((x) => x.name !== sub && (!order.length || order.includes(x.name))), entry].sort((a, b) => rank(a.name) - rank(b.name));
    ref = { $storage: subs[0].$storage, ...(subs[0].mapping ? { mapping: subs[0].mapping } : {}), client: { companies: subs.flatMap((x) => x.companies) }, subs };
  } else {
    ref = { $storage: path, ...(mapping ? { mapping } : {}), client: { companies } };
  }
  const { error } = await supabaseAdmin().from("radar_abm_snapshots").upsert(
    { client_id: clientId, dataset: ref, synced_at: ds.syncedAt ?? new Date().toISOString(), synced_by: by, warnings: warnings ?? [], stats },
    { onConflict: "client_id" }
  );
  if (error) throw new Error(missingTable(error.message) ? MIGRATION_HINT : error.message);
}

// Token de HubSpot según la fuente del cliente (undefined = HubSpot de BullsEye)
export async function hubspotTokenFor(clientId: string, source: RadarClientSettings["hubspot_source"]): Promise<string | undefined> {
  if (source !== "client") return undefined;
  const { data } = await supabaseAdmin().from("client_configs").select("hubspot_access_token").eq("client_id", clientId).maybeSingle();
  const token = ((data as { hubspot_access_token?: string | null } | null)?.hubspot_access_token ?? "").trim();
  if (!token) throw new Error("El cliente no tiene conectado su HubSpot (Configuración → Cliente → HubSpot del cliente).");
  return token;
}

// Resultado de la última sincronización automática (cron) por cliente y
// cuenta: se guarda en allo_response_cache para mostrarlo en el informe, ya
// que los logs de Vercel no se ven desde la app.
export type CronStatus = { at: string; state: "started" | "ok" | "error" | "skipped"; detail?: string };
const cronKey = (clientId: string, sub?: string) => `radar_cron:${clientId}${sub ? `:${subSlug(sub)}` : ""}`;
export async function recordCronStatus(clientId: string, sub: string | undefined, status: Omit<CronStatus, "at">): Promise<void> {
  const { writeMonthCache } = await import("@/lib/celulasSdr/cache");
  await writeMonthCache(cronKey(clientId, sub), { ...status, at: new Date().toISOString() }, 14 * 86400_000);
}
export async function readCronStatus(clientId: string, sub?: string): Promise<CronStatus | null> {
  const { readMonthCache } = await import("@/lib/celulasSdr/cache");
  return (await readMonthCache<CronStatus>(cronKey(clientId, sub))) ?? null;
}
