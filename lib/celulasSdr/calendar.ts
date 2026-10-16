// Calendario de días hábiles del módulo Células SDR. Sin dependencias de
// Node: se usa en el servidor y en el navegador.
//
// Días hábiles = lunes a viernes, menos los feriados de Chile (confirmado
// con BullsEye: se parte solo con los de Chile). Solo se listan los
// feriados que caen en día de semana — los de sábado/domingo no cambian el
// conteo. Agregar acá los del año siguiente cuando se publiquen.
const CHILE_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-04-18", "2025-05-01", "2025-05-21", "2025-06-20",
  "2025-07-16", "2025-08-15", "2025-09-18", "2025-09-19", "2025-10-31",
  "2025-12-08", "2025-12-25",
  // 2026
  "2026-01-01", "2026-04-03", "2026-05-01", "2026-05-21", "2026-06-29",
  "2026-07-16", "2026-09-18", "2026-10-12", "2026-12-08", "2026-12-25",
]);

export const MN = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MNL = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const DN = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const DNL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Todas las fechas se manejan como "YYYY-MM-DD" (día calendario de Chile) y
// se operan en UTC para no depender de la zona horaria del navegador.
export function parseDay(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  const x = parseDay(d);
  x.setUTCDate(x.getUTCDate() + n);
  return dayKey(x);
}
export function dow(d: string): number {
  return parseDay(d).getUTCDay();
}
export function monthOf(d: string): string {
  return d.slice(0, 7);
}
export function isHoliday(d: string): boolean {
  return CHILE_HOLIDAYS.has(d);
}
export function isBusinessDay(d: string): boolean {
  const w = dow(d);
  return w !== 0 && w !== 6 && !CHILE_HOLIDAYS.has(d);
}
export function monthStart(m: string): string {
  return `${m}-01`;
}
export function monthEnd(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return dayKey(new Date(Date.UTC(y, mo, 0, 12)));
}
export function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1, 12));
  return d.toISOString().slice(0, 7);
}
export function businessDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isBusinessDay(d)) out.push(d);
  return out;
}
export function businessDaysInMonth(m: string): number {
  return businessDaysBetween(monthStart(m), monthEnd(m)).length;
}
// Lunes de la semana de `d`.
export function weekStart(d: string): string {
  const w = dow(d);
  return addDays(d, w === 0 ? -6 : 1 - w);
}
export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MNL[mo - 1]} ${y}`;
}
export function dayShort(d: string): string {
  const x = parseDay(d);
  return `${DN[x.getUTCDay()]} ${x.getUTCDate()}`;
}
export function dayLong(d: string): string {
  const x = parseDay(d);
  return `${DNL[x.getUTCDay()]} ${x.getUTCDate()} de ${MNL[x.getUTCMonth()].toLowerCase()}`;
}
export function dayMonthShort(d: string): string {
  const x = parseDay(d);
  return `${x.getUTCDate()} ${MN[x.getUTCMonth()]}`;
}
export function weekLabel(mon: string): string {
  const fri = addDays(mon, 4);
  const a = parseDay(mon), b = parseDay(fri);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MN[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MN[a.getUTCMonth()]}–${b.getUTCDate()} ${MN[b.getUTCMonth()]}`;
}
export function weekShort(mon: string): string {
  const a = parseDay(mon);
  return `${a.getUTCDate()}/${a.getUTCMonth() + 1}`;
}
// "Hoy" en Chile (UTC-4), independiente de la zona del servidor/navegador.
export function chileToday(now = new Date()): string {
  return dayKey(new Date(now.getTime() - 4 * 3600000));
}
