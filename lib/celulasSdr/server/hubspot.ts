import { fetchHSOwners, fetchHSActivityCountsByCreatorDaily } from "@/lib/hubspot";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { chileToday, monthEnd, monthStart } from "@/lib/celulasSdr/calendar";
import { monthCacheTtlMs, readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import type { ChannelDay, HubspotMonthResponse } from "@/lib/celulasSdr/types";


// Módulo Células SDR — Correo / WhatsApp / LinkedIn registrados en HubSpot
// por cada SDR, por día. Igual que en el Ranking SDR, es el total del SDR en
// todos los clientes: HubSpot todavía no sabe a qué cliente de BullsEye
// pertenece cada actividad (confirmado con BullsEye: aceptable por ahora).

const CACHE_VERSION = "v1";

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
  if (from > today) {
    return { month, channels: [], sdrNames: {}, cachedAt: new Date().toISOString(), warnings: [] };
  }
  // Días calendario de Chile (UTC-4) → instantes UTC
  const fromMs = Date.parse(`${from}T04:00:00.000Z`);
  const toMs = Date.parse(`${to}T04:00:00.000Z`) + 24 * 3600000 - 1;

  const [owners, counts] = await Promise.all([fetchHSOwners(), fetchHSActivityCountsByCreatorDaily(fromMs, toMs)]);
  const keyByUserId = new Map<string, { key: string; name: string }>();
  for (const o of owners) {
    if (o.userId === undefined) continue;
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.userId);
    keyByUserId.set(String(o.userId), { key: resolveSdrKey(name), name });
  }

  const byKey = new Map<string, ChannelDay>();
  const sdrNames: Record<string, string> = {};
  for (const [k, v] of counts) {
    const [userId, d] = k.split("|");
    const owner = keyByUserId.get(userId);
    if (!owner) continue;
    sdrNames[owner.key] = sdrNames[owner.key] ?? owner.name;
    const id = `${owner.key}|${d}`;
    const row = byKey.get(id) ?? { d, s: owner.key, email: 0, wa: 0, li: 0 };
    row.email += v.email;
    row.wa += v.whatsapp;
    row.li += v.linkedin;
    byKey.set(id, row);
  }

  const body: HubspotMonthResponse = { month, channels: [...byKey.values()], sdrNames, cachedAt: new Date().toISOString(), warnings: [] };
  await writeMonthCache(cacheKey, body, monthCacheTtlMs(month, today.slice(0, 7)));
  return body;
}
