// Reconfirmación de reuniones (piloto Simplex, nov-2026). Reglas puras, sin
// dependencias de Node: se usan en el servidor (alertas, sync, Pulso ABM) y en
// el navegador (Registro de reuniones de Células SDR).
//
// El SDR (o su líder, o Ingri) marca "Reconfirmada con el prospecto" en el
// Registro de reuniones de Células SDR; el portal lo escribe en "API Reuniones
// - IA" (columnas Reconfirmada / Fecha reconfirmación) y en `meetings`
// (/api/celulas-sdr/records/reconfirm).
//
// Plazos (confirmados en la propuesta "Reconfirmación de reuniones — idea para
// células SDR"):
//   reunión AM (antes de las 13:00 o sin hora) → día hábil anterior:
//       recordatorio 16:00, plazo límite 18:00
//   reunión PM (desde las 13:00)               → mismo día:
//       recordatorio 10:00, plazo límite 12:00
// Día hábil = lunes a viernes sin feriados de Chile (lib/celulasSdr/calendar).
import { addDays, isBusinessDay } from "@/lib/celulasSdr/calendar";

// Clientes del piloto (columna Cliente de la planilla o nombre del cliente en
// la app). RECONF_PILOT_CLIENTS="simplex,otro" lo reemplaza (solo servidor).
export const DEFAULT_PILOT_CLIENTS = ["simplex"];

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function pilotClients(): string[] {
  const env = typeof process !== "undefined" ? process.env?.RECONF_PILOT_CLIENTS : undefined;
  const list = (env ?? "").split(",").map(norm).filter(Boolean);
  return list.length ? list : DEFAULT_PILOT_CLIENTS;
}

// "SIMPLEX", "Simplex Chile" → sí; "Nisum" → no
export function isPilotClient(name: string | null | undefined, pilots: string[] = pilotClients()): boolean {
  const n = norm(name);
  return !!n && pilots.some((p) => n === p || n.startsWith(p + " "));
}

export const AM_PM_CUTOFF = 13;
export const SLOT_TIMES = { amRemind: "16:00", amDeadline: "18:00", pmRemind: "10:00", pmDeadline: "12:00" } as const;

// "09:30", "9:30", "15:00 hrs" → minutos desde medianoche; vacío → null
export function parseHour(h: string | null | undefined): number | null {
  const m = String(h ?? "").match(/^\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh < 24 && mm < 60 ? hh * 60 + mm : null;
}

export function isPmMeeting(hour: string | null | undefined): boolean {
  const min = parseHour(hour);
  return min != null && min >= AM_PM_CUTOFF * 60;
}

export function prevBusinessDay(day: string): string {
  let d = addDays(day, -1);
  for (let i = 0; i < 15 && !isBusinessDay(d); i++) d = addDays(d, -1);
  return d;
}

export type ReconfWindow = {
  day: string;        // día en que se reconfirma (YYYY-MM-DD, Chile)
  remind: string;     // "HH:MM" recordatorio al SDR
  deadline: string;   // "HH:MM" plazo límite (alerta al líder)
  pm: boolean;
};

// Ventana de reconfirmación de una reunión con fecha `md` (YYYY-MM-DD) y hora
export function reconfWindow(md: string | null | undefined, hour: string | null | undefined): ReconfWindow | null {
  if (!md || !/^\d{4}-\d{2}-\d{2}$/.test(md)) return null;
  if (isPmMeeting(hour)) return { day: md, remind: SLOT_TIMES.pmRemind, deadline: SLOT_TIMES.pmDeadline, pm: true };
  return { day: prevBusinessDay(md), remind: SLOT_TIMES.amRemind, deadline: SLOT_TIMES.amDeadline, pm: false };
}

export type ReconfState =
  | "ok"        // reconfirmada
  | "upcoming"  // aún no se abre su ventana
  | "due"       // ventana abierta (desde el recordatorio hasta el plazo)
  | "late"      // venció el plazo sin reconfirmar (la reunión aún no ocurre)
  | "past"      // la reunión ya ocurrió (o no está pendiente) sin reconfirmar
  | "na";       // sin fecha: no se puede calcular

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// now = { day: "YYYY-MM-DD", time: "HH:MM" } en hora de Chile
export function reconfState(
  m: { md: string | null | undefined; hour: string | null | undefined; reconfirmed: boolean; pending: boolean },
  now: { day: string; time: string }
): ReconfState {
  if (m.reconfirmed) return "ok";
  const w = reconfWindow(m.md, m.hour);
  if (!w || !m.md) return "na";
  const start = `${m.md} ${hm(parseHour(m.hour) ?? 9 * 60)}`;
  const cur = `${now.day} ${now.time}`;
  if (!m.pending || cur >= start) return "past";
  if (cur >= `${w.day} ${w.deadline}`) return "late";
  if (cur >= `${w.day} ${w.remind}`) return "due";
  return "upcoming";
}

// Día y hora actuales en Chile
export function chileNow(d = new Date()): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

// Valor de la columna "Reconfirmada" de la planilla
export function isYes(v: string | null | undefined): boolean {
  const s = norm(v);
  return s === "si" || s === "true" || s === "1" || s === "yes";
}

// "dd/MM/yyyy HH:mm" de la planilla → texto tal cual (o null si viene vacío)
export function cleanReconfDate(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 40) : null;
}

// Fecha y hora de la reunión a la que corresponde una reconfirmación
export function reconfKey(md: string | null | undefined, hour: string | null | undefined): string {
  const min = parseHour(hour);
  return `${md ?? ""} ${min == null ? "" : hm(min)}`.trim();
}

// Una reconfirmación hecha desde el portal guarda para qué fecha y hora era;
// si la reunión se movió, ya no vale (hay que volver a reconfirmar). Sin ese
// dato (marcada directo en la planilla) se da por válida.
export function isReconfValid(para: string | null | undefined, md: string | null | undefined, hour: string | null | undefined): boolean {
  return !para || para === reconfKey(md, hour);
}

export const STATE_LABEL: Record<ReconfState, string> = {
  ok: "Reconfirmada",
  upcoming: "Por reconfirmar",
  due: "Reconfirmar ahora",
  late: "Plazo vencido",
  past: "Sin reconfirmar",
  na: "Sin fecha",
};
