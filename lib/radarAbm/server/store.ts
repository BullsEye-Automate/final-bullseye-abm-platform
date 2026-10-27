import { supabaseAdmin } from "@/lib/supabase";
import { mergeConfig } from "../dictionaries";
import type { RadarConfig, RadarDataset } from "../types";

// Radar ABM — lectura y escritura en Supabase (service role, solo servidor).
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
// En el HubSpot de BullsEye el status de empresa es una propiedad por cliente
// ("Status de la asignación - <cliente>"): nunca se toma del mapeo global.
export function effectiveProperties(cfg: RadarConfig, s: RadarClientSettings): Record<string, string> {
  if (s.hubspot_source === "client") return { ...(s.properties ?? {}) };
  const { companyStatus: _global, ...global } = cfg.properties;
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

export type RadarSnapshot = { dataset: RadarDataset; synced_at: string; warnings: string[]; stats: Record<string, number> };

export async function loadSnapshot(clientId: string): Promise<RadarSnapshot | null> {
  const { data, error } = await supabaseAdmin()
    .from("radar_abm_snapshots")
    .select("dataset, synced_at, warnings, stats")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error && !missingTable(error.message)) throw new Error(error.message);
  return (data as RadarSnapshot | null) ?? null;
}

export async function saveSnapshot(clientId: string, ds: RadarDataset, stats: Record<string, number>, by: string): Promise<void> {
  const { error } = await supabaseAdmin().from("radar_abm_snapshots").upsert(
    { client_id: clientId, dataset: ds, synced_at: ds.syncedAt ?? new Date().toISOString(), synced_by: by, warnings: ds.warnings ?? [], stats },
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
