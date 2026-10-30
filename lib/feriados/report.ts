// Alerta de feriados — armado del reporte diario (servidor).
// - Hoy: estado de cada país (normal / feriado / regional / baja actividad).
// - Próximos días hábiles con feriado (ventana de WINDOW_DAYS días).
// - Reuniones que caen en un feriado del país de la empresa, en dos fuentes:
//   la planilla de reuniones de los SDR (tabla meetings, columna País) y las
//   reuniones de HubSpot de BullsEye (país "País" pais_g y región de la
//   empresa asociada). Se clasifican en conflicto / revisar / sin verificar.
// Si HubSpot o la planilla fallan, el reporte sigue con lo demás y avisa.
import { supabaseAdmin } from "@/lib/supabase";
import { fetchHSOwners, hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { canonicalCountry } from "@/lib/celulasSdr/country";
import {
  COUNTRIES,
  COUNTRY_ORDER,
  KIND_RANK,
  countryCodeFromName,
  holidaysOn,
  type CountryCode,
  type Holiday,
} from "./calendar";

export const WINDOW_DAYS = 21; // ventana de "próximos feriados" y de reuniones

export type DayStatus = { country: CountryCode; holidays: Holiday[] };

export type MeetingFlag = {
  level: "conflict" | "review" | "unverified";
  source: "Planilla" | "HubSpot";
  date: string;
  time: string | null;
  who: string; // SDR responsable o dueño en HubSpot
  company: string;
  country: string | null;
  title: string; // título (HubSpot) o cliente (planilla)
  reason: string;
  url?: string;
};

export type HolidayReport = {
  today: string;
  windowEnd: string;
  todayStatus: DayStatus[];
  upcoming: { date: string; holidays: Holiday[] }[]; // días hábiles, sin hoy
  weekend: { date: string; holidays: Holiday[] }[]; // sábados/domingos de la ventana
  flags: MeetingFlag[];
  checked: { sheet: number; hubspot: number };
  warnings: string[];
  generatedAt: string;
};

// ─── Fechas ─────────────────────────────────────────────────────────────────

export function chileDay(now = new Date()): string {
  return dayInZone(now, "America/Santiago");
}

function dayInZone(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function addDays(day: string, n: number): string {
  const x = new Date(`${day}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

const isWeekend = (day: string) => weekday(day) === 0 || weekday(day) === 6;

const normText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

// ─── Clasificación de una reunión ───────────────────────────────────────────

// ¿La región de la empresa calza con la de un feriado regional? (texto libre:
// "Córdoba", "CABA", "Buenos Aires"…). null = no se puede saber.
function regionMatches(holiday: Holiday, region: string | null): boolean | null {
  const r = normText(region ?? "");
  if (!r || !holiday.regions) return null;
  const h = normText(holiday.regions);
  if (r.includes("caba") || r.includes("ciudad autonoma") || r.includes("capital federal")) {
    return h.includes("ciudad de buenos aires");
  }
  const tokens = r.split(/[\s,()-]+/).filter((t) => t.length > 3 && !["provincia", "region", "ciudad"].includes(t));
  return tokens.some((t) => h.includes(t));
}

function classify(
  date: string,
  countryLabel: string | null,
  region: string | null
): { level: MeetingFlag["level"]; reason: string } | null {
  const code = countryCodeFromName(countryLabel);
  if (!code) {
    if (countryLabel) return null; // país fuera del calendario (ej. Ecuador)
    const nat = holidaysOn(date).filter((x) => x.kind === "national");
    if (!nat.length) return null;
    const names = Array.from(new Set(nat.map((x) => COUNTRIES[x.country].name)));
    return { level: "unverified", reason: `Feriado en ${names.join(", ")}; la reunión no tiene país` };
  }
  const list = holidaysOn(date, code).sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  const top = list[0];
  if (!top) return null;
  if (top.kind === "national") return { level: "conflict", reason: `Feriado: ${top.name}` };
  if (top.kind === "regional") {
    const m = regionMatches(top, region);
    if (m === false) return null;
    if (m === true) return { level: "conflict", reason: `Feriado en ${top.regions}: ${top.name}` };
    return { level: "review", reason: `Feriado solo en ${top.regions} (${top.name}); confirmar la ubicación de la empresa` };
  }
  return { level: "review", reason: `Baja actividad: ${top.name}` };
}

// ─── Fuente 1: planilla de reuniones (tabla meetings) ──────────────────────

async function sheetFlags(from: string, to: string): Promise<{ flags: MeetingFlag[]; checked: number }> {
  const db = supabaseAdmin();
  const { data: clientRows } = await db.from("clients").select("id, name");
  const clientNames: Record<string, string> = {};
  for (const c of clientRows ?? []) clientNames[c.id as string] = c.name as string;

  const rows: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 10_000; offset += PAGE) {
    const { data, error } = await db
      .from("meetings")
      .select("id, responsable, sdr_nombre, client_id, pais, fecha_reunion, hora, realizado, empresa")
      .gte("fecha_reunion", from)
      .lte("fecha_reunion", to)
      .order("fecha_reunion", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const flags: MeetingFlag[] = [];
  let checked = 0;
  for (const m of rows) {
    // Solo las que siguen por realizarse (Pendiente / Reagendar)
    const st = normText(m.realizado ?? "");
    if (st === "si" || st === "yes" || st === "no") continue;
    checked++;
    const country = canonicalCountry(m.pais);
    const c = classify(m.fecha_reunion, country, null);
    if (!c) continue;
    flags.push({
      ...c,
      source: "Planilla",
      date: m.fecha_reunion,
      time: (m.hora ?? "").trim() || null,
      who: (m.responsable || m.sdr_nombre || "Sin responsable").trim(),
      company: (m.empresa ?? "").trim() || "Sin empresa",
      country,
      title: m.client_id ? `Cliente: ${clientNames[m.client_id] ?? "—"}` : "Sin cliente",
    });
  }
  return { flags, checked };
}

// ─── Fuente 2: reuniones de HubSpot de BullsEye ─────────────────────────────

const HS = "https://api.hubapi.com";

async function hsPost(path: string, body: unknown): Promise<any> {
  const res = await hsFetchWithRetry(`${HS}${path}`, { method: "POST", headers: hsHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status} en ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function hubspotFlags(from: string, to: string): Promise<{ flags: MeetingFlag[]; checked: number }> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return { flags: [], checked: 0 };
  // Rango amplio en UTC (un día antes y después) y luego se filtra por el día
  // local del país de la empresa.
  const startMs = Date.parse(`${addDays(from, -1)}T00:00:00Z`);
  const endMs = Date.parse(`${addDays(to, 1)}T23:59:59Z`);

  const meetings: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const data = await hsPost("/crm/v3/objects/meetings/search", {
      filterGroups: [
        { filters: [{ propertyName: "hs_meeting_start_time", operator: "BETWEEN", value: String(startMs), highValue: String(endMs) }] },
      ],
      properties: ["hs_meeting_title", "hs_meeting_start_time", "hubspot_owner_id", "hs_meeting_outcome"],
      sorts: [{ propertyName: "hs_meeting_start_time", direction: "ASCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    meetings.push(...(data.results ?? []));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  const active = meetings.filter((m) => {
    const o = (m.properties?.hs_meeting_outcome ?? "").toUpperCase();
    return o !== "CANCELED" && o !== "NO_SHOW" && o !== "COMPLETED";
  });
  if (!active.length) return { flags: [], checked: 0 };

  // Reunión → primera empresa asociada
  const companyOf: Record<string, string> = {};
  for (let i = 0; i < active.length; i += 100) {
    const chunk = active.slice(i, i + 100);
    const data = await hsPost("/crm/v4/associations/meetings/companies/batch/read", {
      inputs: chunk.map((m) => ({ id: String(m.id) })),
    });
    for (const r of data.results ?? []) {
      const to = r.to?.[0]?.toObjectId;
      if (to) companyOf[String(r.from?.id)] = String(to);
    }
  }
  const companyIds = Array.from(new Set(Object.values(companyOf)));
  const companies: Record<string, { name: string; country: string | null; region: string | null }> = {};
  for (let i = 0; i < companyIds.length; i += 100) {
    const data = await hsPost("/crm/v3/objects/companies/batch/read", {
      properties: ["name", "pais_g", "state", "city"],
      inputs: companyIds.slice(i, i + 100).map((id) => ({ id })),
    });
    for (const c of data.results ?? []) {
      const p = c.properties ?? {};
      companies[String(c.id)] = {
        name: p.name ?? "Sin nombre",
        country: canonicalCountry(p.pais_g),
        region: [p.state, p.city].filter(Boolean).join(", ") || null,
      };
    }
  }

  const ownerNames: Record<string, string> = {};
  try {
    for (const o of await fetchHSOwners()) {
      ownerNames[String(o.id)] = [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || String(o.id);
    }
  } catch {
    /* sin nombres de dueño: se muestra el id */
  }

  // Enlace a la reunión: portal y dominio de la cuenta (BullsEye está en EU).
  let recordBase: string | null = null;
  try {
    const res = await hsFetchWithRetry(`${HS}/account-info/v3/details`, { headers: hsHeaders() });
    if (res.ok) {
      const a = await res.json();
      if (a?.portalId) recordBase = `https://${a.uiDomain || "app.hubspot.com"}/contacts/${a.portalId}/record/0-47/`;
    }
  } catch {
    /* sin enlace */
  }

  const flags: MeetingFlag[] = [];
  let checked = 0;
  for (const m of active) {
    const p = m.properties ?? {};
    const start = new Date(p.hs_meeting_start_time);
    if (isNaN(start.getTime())) continue;
    const co = companyOf[String(m.id)] ? companies[companyOf[String(m.id)]] : undefined;
    const code = countryCodeFromName(co?.country);
    const tz = code ? COUNTRIES[code].timeZone : "America/Santiago";
    const date = dayInZone(start, tz);
    if (date < from || date > to) continue;
    checked++;
    const c = classify(date, co?.country ?? null, co?.region ?? null);
    if (!c) continue;
    flags.push({
      ...c,
      source: "HubSpot",
      date,
      time: timeInZone(start, tz),
      who: ownerNames[String(p.hubspot_owner_id)] ?? (p.hubspot_owner_id ? `Dueño ${p.hubspot_owner_id}` : "Sin dueño"),
      company: co?.name ?? "Sin empresa asociada",
      country: co?.country ?? null,
      title: (p.hs_meeting_title ?? "").trim() || "Reunión sin título",
      url: recordBase ? `${recordBase}${m.id}` : undefined,
    });
  }
  return { flags, checked };
}

// ─── Reporte ────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<MeetingFlag["level"], number> = { conflict: 0, review: 1, unverified: 2 };

export async function buildHolidayReport(opts: { today?: string } = {}): Promise<HolidayReport> {
  const today = opts.today ?? chileDay();
  const windowEnd = addDays(today, WINDOW_DAYS);
  const warnings: string[] = [];

  const todayStatus: DayStatus[] = COUNTRY_ORDER.map((country) => ({
    country,
    holidays: holidaysOn(today, country).sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]),
  }));

  const upcoming: HolidayReport["upcoming"] = [];
  const weekend: HolidayReport["weekend"] = [];
  for (let d = addDays(today, 1); d <= windowEnd; d = addDays(d, 1)) {
    const list = holidaysOn(d).sort(
      (a, b) => COUNTRY_ORDER.indexOf(a.country) - COUNTRY_ORDER.indexOf(b.country) || KIND_RANK[b.kind] - KIND_RANK[a.kind]
    );
    if (!list.length) continue;
    (isWeekend(d) ? weekend : upcoming).push({ date: d, holidays: list });
  }

  // Calendario sin cargar para parte de la ventana
  const missing = COUNTRY_ORDER.filter((c) => COUNTRIES[c].coveredThrough < windowEnd).map((c) => COUNTRIES[c].name);
  if (missing.length) {
    warnings.push(`Falta cargar el calendario del año siguiente de: ${missing.join(", ")} (lib/feriados/calendar.ts).`);
  }

  const [sheet, hub] = await Promise.allSettled([sheetFlags(today, windowEnd), hubspotFlags(today, windowEnd)]);
  const flags: MeetingFlag[] = [];
  const checked = { sheet: 0, hubspot: 0 };
  if (sheet.status === "fulfilled") {
    flags.push(...sheet.value.flags);
    checked.sheet = sheet.value.checked;
  } else {
    warnings.push(`No se pudo revisar la planilla de reuniones: ${(sheet.reason as Error)?.message ?? sheet.reason}`);
  }
  if (hub.status === "fulfilled") {
    flags.push(...hub.value.flags);
    checked.hubspot = hub.value.checked;
  } else {
    warnings.push(`No se pudieron revisar las reuniones de HubSpot: ${(hub.reason as Error)?.message ?? hub.reason}`);
  }
  flags.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.date.localeCompare(b.date) || a.who.localeCompare(b.who));

  return { today, windowEnd, todayStatus, upcoming, weekend, flags, checked, warnings, generatedAt: new Date().toISOString() };
}
