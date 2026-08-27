// Helpers compartidos por los reportes de Análisis SDR (Ranking SDR,
// Ranking País, Gráfico Resultados SDR) que consultan Allo (llamadas) y
// Supabase (reuniones). Se extrajeron de app/api/analisis/sdr/route.ts para
// no duplicar (y potencialmente desalinear) esta lógica en cada reporte
// nuevo que agrupe los mismos datos de otra forma.
import type { RangeKey } from "@/lib/dashboardRanges";

export const MIN_REAL_CONVERSATION_SECONDS = 60;

export function isConnected(duration: number, result: string | null): boolean {
  return (result === "ANSWERED" || result === "TRANSFERRED") && duration >= MIN_REAL_CONVERSATION_SECONDS;
}

export function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// dashboardRanges.resolveRange corta los rangos "this_*" (en curso) en el
// día de hoy — correcto para "llamadas realizadas" (no puede haber llamadas
// futuras), pero incorrecto para "reuniones agendadas": una reunión
// Pendiente puede estar agendada para un día futuro dentro del mismo
// período (ej. agendada para el 30 si hoy es 26), y quedaba excluida.
// Esta función calcula el fin real del período (sin cortar en "hoy") para
// usarlo solo en la consulta de reuniones.
export function endOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function resolveMeetingsRangeEnd(rangeKey: RangeKey, fallbackEnd: Date, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  switch (rangeKey) {
    case "this_week": {
      const day = now.getUTCDay();
      const daysUntilSunday = day === 0 ? 0 : 7 - day;
      return endOfDayUTC(new Date(Date.UTC(y, m, now.getUTCDate() + daysUntilSunday)));
    }
    case "this_month":
      return endOfDayUTC(new Date(Date.UTC(y, m + 1, 0)));
    case "this_quarter": {
      const qStartMonth = Math.floor(m / 3) * 3;
      return endOfDayUTC(new Date(Date.UTC(y, qStartMonth + 3, 0)));
    }
    case "this_semester":
      return endOfDayUTC(new Date(Date.UTC(y, m < 6 ? 6 : 12, 0)));
    case "this_year":
      return endOfDayUTC(new Date(Date.UTC(y, 12, 0)));
    default:
      // "today", "last_*" y "custom" ya representan un período completo
      return fallbackEnd;
  }
}

// call.date de Allo es un timestamp ISO completo en UTC, no "YYYY-MM-DD".
// Los rangos de fecha (dateFrom/dateTo) representan días calendario del
// negocio, que opera en horario de Chile (UTC-4, sin horario de verano
// desde 2019) — no UTC. Sin este ajuste, llamadas hechas entre las 20:00 y
// medianoche hora Chile caen, en UTC, dentro del día calendario siguiente,
// y quedaban excluidas del día correcto (se detectó comparando 'Ayer' con
// el dashboard de Allo: la app contaba menos llamadas que Allo).
// NOTA: asume horario de Chile para todos los números — si en el futuro
// se opera con clientes en otro país, esto debe volverse por número
// (AlloNumber.country) en vez de un offset fijo.
export const CHILE_UTC_OFFSET_HOURS = -4;
export function callDateKey(isoDate: string): string {
  const shifted = new Date(new Date(isoDate).getTime() + CHILE_UTC_OFFSET_HOURS * 3600000);
  return shifted.toISOString().slice(0, 10);
}

// Normaliza nombres de SDR para poder emparejar el usuario de Allo (llamadas)
// con el nombre cargado manualmente en el Excel de reuniones (meetings.sdr_nombre),
// que puede diferir en mayúsculas, tildes o espacios.
export function normalizeSdrName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Alias manuales para nombres que no calzan ni normalizando (apodos, solo
// nombre de pila, faltas de ortografía en el Excel, etc.). Clave = nombre tal
// como aparece en meetings.responsable / sdr_nombre (normalizado), valor =
// nombre tal como está registrado en Allo (normalizado). Cuando un SDR nuevo
// no calce, se agrega acá una línea más — confirmado con BullsEye caso a caso.
export const SDR_NAME_ALIASES: Record<string, string> = {
  [normalizeSdrName("Jacqueline Fuentes")]: normalizeSdrName("Jaqueline Fuentes"),
  [normalizeSdrName("María José")]:         normalizeSdrName("María José Espinoza"),
  [normalizeSdrName("Pedro")]:              normalizeSdrName("Pedro Gallardo"),
};

export function resolveSdrKey(name: string): string {
  const normalized = normalizeSdrName(name);
  return SDR_NAME_ALIASES[normalized] || normalized;
}
