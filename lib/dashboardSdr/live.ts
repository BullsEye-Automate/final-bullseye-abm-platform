import { CO_ORDER, EXCLUDE } from "@/lib/radarAbm/dictionaries";
import { detectProperties, loadPropertyCatalog, normLabel, searchAll, type DetectedProperty } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, subMapping, universeMode, wishlistOnly } from "@/lib/radarAbm/server/store";
import { supabaseAdmin } from "@/lib/supabase";
import { makePersonResolver, readMaster } from "@/lib/celulasSdr/sheets";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import type { SdrSlice } from "./types";

// Dashboard SDR → «Mis listas» en vivo (26-nov-2026, pedido de BullsEye: con
// la licencia de HubSpot las listas son estáticas y el informe de Pulso ABM
// se sincroniza una vez al día, a veces con días de atraso). Lee en el momento
// de HubSpot las empresas del SDR en cada cliente de su cartera: empresas con
// "Status de la asignación - <cliente>" y "SDR - <cliente>" con valor, con los
// mismos filtros del universo de Pulso (titular "Cliente BullsEye Empresa",
// solo wishlist en Nisum / Crossnet, status excluidos de La Biblia). Solo
// lectura.

export type LiveCompany = { hs: string; n: string; st: string; pais?: string };
export type LiveClient = { ok: true; rows: LiveCompany[] } | { ok: false; error: string };
export type LiveResponse = { at: string; clients: Record<string, LiveClient> };

const canon = (s: string) => normLabel(s.replace(/\p{Extended_Pictographic}/gu, ""));
const compact = (x: string) => normLabel(x).replace(/ /g, "");
const labeler = (p: DetectedProperty | undefined) => {
  const m = new Map((p?.options ?? []).map((o) => [o.value, o.label]));
  return (v: string | null | undefined) => (v ? v.split(";").map((x) => m.get(x) ?? x).join("; ") : null);
};

export async function liveCompanies(sdrKey: string, accts: SdrSlice["accts"]): Promise<LiveResponse> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const master = await readMaster(spreadsheetId, []);
  const resolvePerson = makePersonResolver(master.people);
  const isMine = (raw: string | null) => !!raw?.trim() && resolveSdrKey(resolvePerson(raw.trim()).name) === sdrKey;
  const cfg = await loadRadarConfig();
  const official = CO_ORDER.filter((s) => s !== "CONV");
  const canonMap = new Map(official.map((o) => [canon(o), o]));
  for (const [from, to] of Object.entries(cfg.companyAliases ?? {})) canonMap.set(canon(from), to);
  const db = supabaseAdmin();
  const ids = Array.from(new Set(Object.values(accts).map((a) => a.id)));
  const { data: rows } = await db.from("clients").select("id, name").in("id", ids);
  const nameOf = new Map((rows ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));

  const out: LiveResponse = { at: new Date().toISOString(), clients: {} };
  // De a uno: comparten el freno de búsquedas de HubSpot (~3 req/s)
  for (const [client, a] of Object.entries(accts)) {
    try {
      const name = nameOf.get(a.id) ?? client;
      const settings = await loadClientSettings(a.id);
      if (universeMode(settings, name) === "client") { out.clients[client] = { ok: false, error: "En este cliente el status sale del ciclo de vida de HubSpot: se muestra el informe de Pulso." }; continue; }
      const token = await hubspotTokenFor(a.id, settings.hubspot_source);
      const { catalog } = await loadPropertyCatalog(token);
      const mapping = a.sub ? subMapping(cfg, settings, a.sub) : effectiveProperties(cfg, settings);
      const P = Object.fromEntries(detectProperties(mapping, catalog, a.sub || name).map((d) => [d.key, d]));
      const statusProp = P.companyStatus?.property, sdrProp = P.companySdr?.property;
      if (!statusProp || !sdrProp) { out.clients[client] = { ok: false, error: "No se encontró la propiedad de status o de SDR de este cliente en HubSpot." }; continue; }
      // Titular de la cuenta (mismo criterio que el sync de Pulso)
      const uniCo = (catalog.companies ?? []).find((x) => x.name === (settings.properties?.universeCompanyClient || "cliente_bullseye_empresa"));
      const uniValue = (a.sub ? "" : (settings.hubspot_client_value ?? "").trim()) || a.sub || name;
      const c = compact(uniValue);
      const opt = (uniCo?.options ?? []).find((o) => compact(o.label) === c || compact(o.value) === c)
        ?? (c.length >= 4 ? (uniCo?.options ?? []).find((o) => { const l = compact(o.label); return l.length >= 4 && (l.startsWith(c) || c.startsWith(l)); }) : undefined);
      const wl = wishlistOnly(settings, name) ? P.companyWishlist?.property : null;
      const props = ["name", statusProp, sdrProp, "pais_g", "country", ...(uniCo && opt ? [uniCo.name] : []), ...(wl ? [wl] : [])];
      const raw = await searchAll("companies", [{ filters: [{ propertyName: statusProp, operator: "HAS_PROPERTY" }, { propertyName: sdrProp, operator: "HAS_PROPERTY" }] }], props, token);
      const stLabel = labeler(P.companyStatus), sdrLabel = labeler(P.companySdr), wlLabel = labeler(P.companyWishlist);
      const list: LiveCompany[] = [];
      for (const r of raw) {
        const p = r.properties;
        if (!isMine(sdrLabel(p[sdrProp]))) continue;
        if (uniCo && opt && !(p[uniCo.name] ?? "").split(";").map((x) => x.trim()).includes(opt.value)) continue;
        if (wl && !["si", "yes", "true", "1"].includes(normLabel(wlLabel(p[wl]) ?? ""))) continue;
        const label = (stLabel(p[statusProp]) ?? "").trim();
        if (!label) continue;
        const st = canonMap.get(canon(label)) ?? label;
        if (st === EXCLUDE) continue;
        list.push({ hs: r.id, n: p.name || `Empresa ${r.id}`, st, ...(p.pais_g || p.country ? { pais: (p.pais_g || p.country)! } : {}) });
      }
      out.clients[client] = { ok: true, rows: list };
    } catch (e) {
      out.clients[client] = { ok: false, error: (e as Error).message || "Error leyendo HubSpot" };
    }
  }
  return out;
}
