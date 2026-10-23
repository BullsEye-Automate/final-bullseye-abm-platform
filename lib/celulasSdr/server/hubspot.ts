import { fetchHSOwners, fetchHSActivityCountsByCreatorDaily } from "@/lib/hubspot";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { supabaseAdmin } from "@/lib/supabase";
import { chileToday, monthEnd, monthStart } from "@/lib/celulasSdr/calendar";
import { monthCacheTtlMs, readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import type { ChannelDay, DataWarning, HubspotMonthResponse } from "@/lib/celulasSdr/types";


// Módulo Células SDR — Correo / WhatsApp / LinkedIn registrados en HubSpot
// por cada SDR, por día. Cada actividad se registra en el HubSpot del
// cliente que se trabaja (el de BullsEye o el propio del cliente) y no se
// duplica entre cuentas (confirmado con BullsEye), así que se suman todas:
// - HubSpot de BullsEye (HUBSPOT_ACCESS_TOKEN): c = null.
// - HubSpot propio de cada cliente (client_configs.hubspot_access_token):
//   c = id del cliente, para poder mostrar sus canales con filtro de cliente.
// Si un HubSpot falla, se sigue con los demás y se avisa en `warnings`.

const CACHE_VERSION = "v2";

type Account = { clientId: string | null; label: string; token?: string };

async function loadAccounts(): Promise<Account[]> {
  const accounts: Account[] = [{ clientId: null, label: "BullsEye" }];
  const db = supabaseAdmin();
  const { data } = await db
    .from("client_configs")
    .select("client_id, hubspot_access_token, clients(name)")
    .not("hubspot_access_token", "is", null);
  for (const r of (data ?? []) as any[]) {
    const token = (r.hubspot_access_token ?? "").trim();
    if (!token) continue;
    const name = Array.isArray(r.clients) ? r.clients[0]?.name : r.clients?.name;
    accounts.push({ clientId: r.client_id, label: name ?? r.client_id, token });
  }
  return accounts;
}

// Nombre del usuario de HubSpot → clave de SDR. En el HubSpot de un cliente
// el SDR puede tener otro correo, por eso se resuelve por nombre (alias de
// lib/sdrAnalytics.ts) y, sin nombre, por el correo.
async function ownersByUserId(token?: string) {
  const owners = await fetchHSOwners(token);
  const out = new Map<string, { key: string; name: string }>();
  for (const o of owners) {
    if (o.userId === undefined) continue;
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.userId);
    out.set(String(o.userId), { key: resolveSdrKey(name), name });
  }
  return out;
}

export async function loadHubspotMonth(month: string, refresh = false): Promise<HubspotMonthResponse> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month (YYYY-MM) es requerido");
  const today = chileToday();
  const cacheKey = `celulas-sdr:hubspot:${CACHE_VERSION}:${month}`;
  if (!refresh) {
    const cached = await readMonthCache<HubspotMonthResponse>(cacheKey);
    if (cached) return cached;
  }

  const from = monthStart(month);
  const end = monthEnd(month);
  const to = end > today ? today : end;
  const accounts = await loadAccounts();
  const connectedClients = accounts.filter((a) => a.clientId).map((a) => a.clientId as string);
  if (from > today) {
    return { month, channels: [], connectedClients, sdrNames: {}, cachedAt: new Date().toISOString(), warnings: [] };
  }
  // Días calendario de Chile (UTC-4) → instantes UTC
  const fromMs = Date.parse(`${from}T04:00:00.000Z`);
  const toMs = Date.parse(`${to}T04:00:00.000Z`) + 24 * 3600000 - 1;

  const byKey = new Map<string, ChannelDay>();
  const sdrNames: Record<string, string> = {};
  const warnings: DataWarning[] = [];
  let bullseyeFailed = false;

  // De a una cuenta: el límite de la API de búsqueda de HubSpot es por
  // cuenta, pero así la función no dispara demasiadas llamadas a la vez.
  for (const acc of accounts) {
    try {
      const [owners, counts] = await Promise.all([
        ownersByUserId(acc.token),
        fetchHSActivityCountsByCreatorDaily(fromMs, toMs, acc.token),
      ]);
      for (const [k, v] of counts) {
        const [userId, d] = k.split("|");
        const owner = owners.get(userId);
        if (!owner) continue;
        sdrNames[owner.key] = sdrNames[owner.key] ?? owner.name;
        const id = `${owner.key}|${d}|${acc.clientId ?? ""}`;
        const row = byKey.get(id) ?? { d, s: owner.key, c: acc.clientId, email: 0, wa: 0, li: 0 };
        row.email += v.email;
        row.wa += v.whatsapp;
        row.li += v.linkedin;
        byKey.set(id, row);
      }
    } catch (e: any) {
      if (!acc.clientId) bullseyeFailed = true;
      warnings.push({ source: `HubSpot ${acc.label}`, message: String(e?.message ?? e).slice(0, 300) });
    }
  }
  // si falló el HubSpot de BullsEye (el que trae casi todo) se reporta el
  // error en vez de cachear un mes a medias; un cliente caído solo avisa
  if (bullseyeFailed) throw new Error(warnings[0]?.message ?? "Error leyendo HubSpot");

  const body: HubspotMonthResponse = {
    month, channels: [...byKey.values()], connectedClients, sdrNames, cachedAt: new Date().toISOString(), warnings,
  };
  // con algún HubSpot caído se cachea poco rato, para reintentar pronto
  const ttl = warnings.length ? 10 * 60 * 1000 : monthCacheTtlMs(month, today.slice(0, 7));
  await writeMonthCache(cacheKey, body, ttl);
  return body;
}
