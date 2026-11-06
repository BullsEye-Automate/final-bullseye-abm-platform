import { isBusinessDay } from "@/lib/celulasSdr/calendar";

// Respuestas Lemlist → SDR: los correos a SDR y KAM solo salen en horario
// laboral de Chile (pedido de BullsEye, 6-nov-2026): lunes a viernes hábiles
// (sin feriados de Chile), de 9:00 a 18:00. Fuera de ese horario la respuesta
// se procesa igual (clasificación, Hot Calling y pausa en Lemlist) y el aviso
// queda en cola hasta el siguiente horario laboral.
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

export function chileNow(now = new Date()): { day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

export function inBusinessHours(now = new Date()): boolean {
  const { day, hour } = chileNow(now);
  return isBusinessDay(day) && hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}
