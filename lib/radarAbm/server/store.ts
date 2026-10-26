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
};

export const DEFAULT_CLIENT_SETTINGS = (clientId: string): RadarClientSettings => ({
  client_id: clientId,
  hubspot_source: "bullseye",
  hubspot_client_value: null,
  deep: null,
  pipeline: null,
  portal_enabled: true,
});

const missingTable = (msg: string) => /does not exist|relation .* not found|Could not find the table/i.test(msg);
export const MIGRATION_HINT = "Falta ejecutar la migración supabase/20261026_radar_abm_migration.sql en Supabase.";

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
  const { error } = await supabaseAdmin()
    .from("radar_abm_clients")
    .upsert({ ...s, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) throw new Error(missingTable(error.message) ? MIGRATION_HINT : error.message);
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
