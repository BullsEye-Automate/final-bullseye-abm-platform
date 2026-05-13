// Presets de rango de fecha para el dashboard.
// Todas las fechas se calculan en hora local del servidor (Vercel = UTC),
// pero "esta semana" se interpreta como semana ISO (lunes-domingo).
//
// Para cada preset devolvemos el rango actual + el período "anterior"
// equivalente (misma longitud, justo antes) para calcular deltas.

export type RangeKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_semester"
  | "last_semester"
  | "this_year"
  | "last_year";

export const RANGE_LABELS: Record<RangeKey, string> = {
  this_week: "Esta semana",
  last_week: "Semana pasada",
  this_month: "Este mes",
  last_month: "Mes pasado",
  this_semester: "Este semestre",
  last_semester: "Semestre pasado",
  this_year: "Este año",
  last_year: "Año pasado"
};

export const RANGE_ORDER: RangeKey[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_semester",
  "last_semester",
  "this_year",
  "last_year"
];

export type DateRange = {
  start: Date;
  end: Date;
  label: string;
  /** Período anterior de igual longitud, para comparativas vs. */
  previous: { start: Date; end: Date };
};

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function startOfMonth(year: number, monthIdx: number): Date {
  return new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0, 0));
}

function endOfMonth(year: number, monthIdx: number): Date {
  // Día 0 del mes siguiente = último día del mes actual.
  return new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999));
}

function startOfIsoWeek(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  return addDays(r, diff);
}

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  const label = RANGE_LABELS[key];

  switch (key) {
    case "this_week": {
      const start = startOfIsoWeek(now);
      const end = endOfDay(now);
      return {
        start,
        end,
        label,
        previous: {
          start: addDays(start, -7),
          end: endOfDay(addDays(start, -1))
        }
      };
    }
    case "last_week": {
      const thisStart = startOfIsoWeek(now);
      const start = addDays(thisStart, -7);
      const end = endOfDay(addDays(thisStart, -1));
      return {
        start,
        end,
        label,
        previous: {
          start: addDays(start, -7),
          end: endOfDay(addDays(start, -1))
        }
      };
    }
    case "this_month": {
      const start = startOfMonth(now.getUTCFullYear(), now.getUTCMonth());
      const end = endOfDay(now);
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 1),
          end: endOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 1)
        }
      };
    }
    case "last_month": {
      const start = startOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 1);
      const end = endOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 1);
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 2),
          end: endOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 2)
        }
      };
    }
    case "this_semester": {
      const year = now.getUTCFullYear();
      const isS1 = now.getUTCMonth() < 6;
      const start = startOfMonth(year, isS1 ? 0 : 6);
      const end = endOfDay(now);
      const prevYear = isS1 ? year - 1 : year;
      const prevMonth = isS1 ? 6 : 0;
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(prevYear, prevMonth),
          end: endOfMonth(prevYear, prevMonth + 5)
        }
      };
    }
    case "last_semester": {
      const year = now.getUTCFullYear();
      const isS1 = now.getUTCMonth() < 6;
      // Si ahora es S1, el "semestre pasado" es S2 del año anterior.
      const prevYear = isS1 ? year - 1 : year;
      const prevMonth = isS1 ? 6 : 0;
      const start = startOfMonth(prevYear, prevMonth);
      const end = endOfMonth(prevYear, prevMonth + 5);
      const prevPrevYear = isS1 ? year - 1 : year - 1;
      const prevPrevMonth = isS1 ? 0 : 6;
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(prevPrevYear, prevPrevMonth),
          end: endOfMonth(prevPrevYear, prevPrevMonth + 5)
        }
      };
    }
    case "this_year": {
      const year = now.getUTCFullYear();
      const start = startOfMonth(year, 0);
      const end = endOfDay(now);
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(year - 1, 0),
          end: endOfMonth(year - 1, 11)
        }
      };
    }
    case "last_year": {
      const year = now.getUTCFullYear() - 1;
      const start = startOfMonth(year, 0);
      const end = endOfMonth(year, 11);
      return {
        start,
        end,
        label,
        previous: {
          start: startOfMonth(year - 1, 0),
          end: endOfMonth(year - 1, 11)
        }
      };
    }
  }
}

export function isValidRangeKey(k: string): k is RangeKey {
  return RANGE_ORDER.includes(k as RangeKey);
}
