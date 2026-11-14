// Cuentas estancadas (Dashboard SDR + alerta semanal): empresas que siguen en
// "Asignada" (sin gestionar) 15 días hábiles o más después de su fecha de
// asignación. Confirmado con BullsEye (nov-2026). Sin dependencias de Node:
// se usa en el servidor y en el navegador.
import { addDays, isBusinessDay } from "@/lib/celulasSdr/calendar";

export const STALE_BUSINESS_DAYS = 15;

const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Status que significan "asignada, aún sin gestionar"
export function isUnworkedStatus(st: string): boolean {
  const t = norm(st);
  return t === "asignada" || t === "por gestionar" || t === "sin status";
}

// Días hábiles (lun–vie sin feriados de Chile) desde el día siguiente a la
// asignación hasta hoy, inclusive.
export function businessDaysSince(from: string, today: string): number {
  if (!from || from >= today) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= today; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}

// Días hábiles en "Asignada"; null si la empresa no está sin gestionar o no
// tiene fecha de asignación.
export function staleDays(c: { st: string; asg: string }, today: string): number | null {
  if (!isUnworkedStatus(c.st) || !c.asg) return null;
  return businessDaysSince(c.asg, today);
}

export function isStale(c: { st: string; asg: string }, today: string): boolean {
  const d = staleDays(c, today);
  return d !== null && d >= STALE_BUSINESS_DAYS;
}
