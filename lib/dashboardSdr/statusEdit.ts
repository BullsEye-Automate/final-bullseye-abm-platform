import { supabaseAdmin } from "@/lib/supabase";
import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { CO_ORDER, CT_ORDER } from "@/lib/radarAbm/dictionaries";
import { detectProperties, loadPropertyCatalog, normLabel } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, subMapping, universeMode } from "@/lib/radarAbm/server/store";

// Dashboard SDR — cambiar el status de una empresa ("Status de la asignación -
// <cliente>") o de un contacto ("Asignación BullsEye por llamar - <cliente>")
// desde el dashboard (nov-2026, pedido de BullsEye). Escribe en HubSpot la
// misma propiedad que lee Pulso ABM (detectProperties, con el mapeo del
// cliente o de su cuenta dentro del HubSpot). El cambio queda además en
// allo_response_cache (`dashboard_sdr_status:<cliente>:<cuenta>:<tipo>:<id>`)
// y el dashboard lo aplica sobre el informe de Pulso hasta que Pulso vuelva a
// sincronizar (el informe nuevo ya trae el valor de HubSpot).
// No se puede en: HubSpot propio del cliente (token de solo lectura) y modo
// "Cliente BullsEye" (el status sale del ciclo de vida, no de una propiedad).

export type StatusType = "company" | "contact";
export type StatusOption = { value: string; label: string };
type PropInfo = { property: string; label: string; options: StatusOption[] } | null;
type ClientStatusProps = { writable: boolean; reason?: string; token?: string; company: PropInfo; contact: PropInfo };

const OVERRIDE_PREFIX = "dashboard_sdr_status:";
const OVERRIDE_TTL_MS = 45 * 86_400_000;
const overrideKey = (clientId: string, sub: string | null, type: StatusType, hsId: string) => `${OVERRIDE_PREFIX}${clientId}:${sub || "-"}:${type}:${hsId}`;

// Texto oficial del status (mismo criterio que el sync de Pulso)
const canon = (s: string) => normLabel(s.replace(/\p{Extended_Pictographic}/gu, ""));
function canonical(label: string, official: string[], aliases: Record<string, string> = {}): string {
  const map = new Map(official.map((o) => [canon(o), o]));
  for (const [from, to] of Object.entries(aliases)) map.set(canon(from), to);
  return map.get(canon(label)) ?? label;
}

const propsCache = new Map<string, { at: number; v: ClientStatusProps }>();
export async function loadStatusProps(clientId: string, sub: string | null): Promise<ClientStatusProps> {
  const ck = `${clientId}:${sub ?? ""}`;
  const hit = propsCache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");
  const [cfg, settings] = await Promise.all([loadRadarConfig(), loadClientSettings(clientId)]);
  let v: ClientStatusProps;
  if (settings.hubspot_source === "client") {
    v = { writable: false, reason: "Este cliente trabaja en su propio HubSpot y la plataforma solo tiene permiso de lectura: cambia el status directo en su HubSpot.", company: null, contact: null };
  } else if (universeMode(settings, client.name) === "client") {
    v = { writable: false, reason: "En este cliente el status sale del ciclo de vida de HubSpot, no de una propiedad de asignación.", company: null, contact: null };
  } else {
    const token = await hubspotTokenFor(clientId, settings.hubspot_source);
    const { catalog } = await loadPropertyCatalog(token);
    const mapping = sub ? subMapping(cfg, settings, sub) : effectiveProperties(cfg, settings);
    const P = Object.fromEntries(detectProperties(mapping, catalog, sub || client.name).map((d) => [d.key, d]));
    const info = (k: string): PropInfo => (P[k]?.found && P[k].property ? { property: P[k].property!, label: P[k].propLabel ?? P[k].property!, options: P[k].options ?? [] } : null);
    v = { writable: true, token, company: info("companyStatus"), contact: info("contactStatus") };
  }
  propsCache.set(ck, { at: Date.now(), v });
  return v;
}

export async function statusOptions(clientId: string, sub: string | null) {
  const p = await loadStatusProps(clientId, sub);
  return {
    writable: p.writable, reason: p.reason ?? null,
    company: p.company ? { label: p.company.label, options: p.company.options } : null,
    contact: p.contact ? { label: p.contact.label, options: p.contact.options } : null,
  };
}

export class StatusConflict extends Error {}

// Escribe el status en HubSpot. `prev` = el status que veía el usuario: si en
// HubSpot ya hay otro valor (alguien lo cambió), no pisa (StatusConflict).
export async function updateStatus(opts: { clientId: string; sub: string | null; type: StatusType; hsId: string; value: string; prev: string | null; by: string }) {
  const p = await loadStatusProps(opts.clientId, opts.sub);
  if (!p.writable) throw new Error(p.reason ?? "No se puede cambiar el status en este cliente.");
  const prop = opts.type === "company" ? p.company : p.contact;
  if (!prop) throw new Error(`No se encontró la propiedad de status ${opts.type === "company" ? "de empresa" : "de contacto"} de este cliente.`);
  const opt = prop.options.find((o) => o.value === opts.value);
  if (!opt) throw new Error("Ese status no es una opción de la propiedad en HubSpot.");
  if (!/^\d+$/.test(opts.hsId)) throw new Error("Id de HubSpot inválido.");
  const obj = opts.type === "company" ? "companies" : "contacts";
  const url = `https://api.hubapi.com/crm/v3/objects/${obj}/${opts.hsId}`;

  // Valor actual en HubSpot
  const cur = await hsFetchWithRetry(`${url}?properties=${encodeURIComponent(prop.property)}`, { headers: hsHeaders(p.token) });
  if (!cur.ok) throw new Error(`HubSpot ${cur.status} al leer el registro.`);
  const curVal: string | null = (await cur.json())?.properties?.[prop.property] ?? null;
  const curLabel = prop.options.find((o) => o.value === curVal)?.label ?? curVal ?? "";
  const cfg = await loadRadarConfig();
  const official = opts.type === "company" ? CO_ORDER : CT_ORDER;
  const aliases = opts.type === "company" ? cfg.companyAliases : cfg.contactAliases;
  if (opts.prev != null && curVal !== opts.value && canon(canonical(curLabel || "", official, aliases)) !== canon(opts.prev) && !(opts.prev === "Sin status" && !curVal)) {
    throw new StatusConflict(`En HubSpot el status ya es «${curLabel || "vacío"}» (alguien lo cambió). Actualiza el dashboard y vuelve a intentarlo.`);
  }

  const res = await hsFetchWithRetry(url, { method: "PATCH", headers: hsHeaders(p.token), body: JSON.stringify({ properties: { [prop.property]: opts.value } }) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${t.slice(0, 200)}`);
  }
  const st = canonical(opt.label, official, aliases);
  const at = new Date().toISOString();
  const { error } = await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: overrideKey(opts.clientId, opts.sub, opts.type, opts.hsId), response: { st, value: opts.value, prev: opts.prev, by: opts.by, at }, expires_at: new Date(Date.now() + OVERRIDE_TTL_MS).toISOString() },
    { onConflict: "cache_key" }
  );
  if (error) console.error("Dashboard SDR: no se pudo guardar el cambio de status:", error.message);
  return { st, at };
}

// Cambios de status hechos desde el dashboard (vigentes)
export type StatusOverride = { st: string; at: string };
export async function loadStatusOverrides(): Promise<Map<string, StatusOverride>> {
  const out = new Map<string, StatusOverride>();
  try {
    const { data } = await supabaseAdmin().from("allo_response_cache").select("cache_key, response, expires_at")
      .like("cache_key", `${OVERRIDE_PREFIX}%`).gt("expires_at", new Date().toISOString()).limit(5000);
    for (const r of data ?? []) {
      const v = r.response as { st?: string; at?: string };
      if (v?.st && v.at) out.set(String(r.cache_key).slice(OVERRIDE_PREFIX.length), { st: v.st, at: v.at });
    }
  } catch (e) {
    console.error("Dashboard SDR: no se pudieron leer los cambios de status:", e);
  }
  return out;
}
export const overrideId = (clientId: string, sub: string | null, type: StatusType, hsId: string) => `${clientId}:${sub || "-"}:${type}:${hsId}`;
