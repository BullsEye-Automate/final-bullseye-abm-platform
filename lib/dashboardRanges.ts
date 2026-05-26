// Utilidad para resolver rangos de fecha del dashboard operativo
// Todos los cálculos en UTC

export type RangeKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_semester"
  | "last_semester"
  | "this_year"
  | "last_year";

export type DateRange = {
  start: Date;
  end: Date;
  label: string;
  previous: { start: Date; end: Date };
};

export const RANGE_LABELS: Record<RangeKey, string> = {
  this_week:      "Esta semana",
  last_week:      "Semana pasada",
  this_month:     "Este mes",
  last_month:     "Mes pasado",
  this_semester:  "Este semestre",
  last_semester:  "Semestre pasado",
  this_year:      "Este año",
  last_year:      "Año pasado",
};

// Inicio de la semana ISO (lunes) en UTC
function getISOWeekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0=dom, 1=lun ... 6=sab
  const diff = (day === 0 ? -6 : 1 - day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

// Fin de día UTC (23:59:59.999)
function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

// Principio del día UTC
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Último día del mes anterior
function lastDayOfPrevMonth(year: number, month: number): Date {
  // month es 0-indexed; si month=0 (enero), queremos dic del año anterior
  return new Date(Date.UTC(year, month, 0)); // día 0 = último del mes anterior
}

export function resolveRange(key: RangeKey, now?: Date): DateRange {
  const today = now ?? new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-indexed
  const d = today.getUTCDate();

  switch (key) {
    case "this_week": {
      const weekStart = getISOWeekStart(today);
      const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
      const prevWeekEnd   = new Date(weekStart.getTime() - 1);
      return {
        start: weekStart,
        end: endOfDay(today),
        label: RANGE_LABELS.this_week,
        previous: { start: prevWeekStart, end: prevWeekEnd },
      };
    }

    case "last_week": {
      const thisWeekStart = getISOWeekStart(today);
      const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);
      const lastWeekEnd   = new Date(thisWeekStart.getTime() - 1);
      const prevWeekStart = new Date(lastWeekStart.getTime() - 7 * 86400000);
      const prevWeekEnd   = new Date(lastWeekStart.getTime() - 1);
      return {
        start: lastWeekStart,
        end: lastWeekEnd,
        label: RANGE_LABELS.last_week,
        previous: { start: prevWeekStart, end: prevWeekEnd },
      };
    }

    case "this_month": {
      const start = new Date(Date.UTC(y, m, 1));
      const end   = endOfDay(today);
      // Período anterior: mes completo anterior
      const prevStart = new Date(Date.UTC(y, m - 1, 1));
      const prevEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
      return { start, end, label: RANGE_LABELS.this_month, previous: { start: prevStart, end: prevEnd } };
    }

    case "last_month": {
      const start    = new Date(Date.UTC(y, m - 1, 1));
      const end      = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
      const prevStart = new Date(Date.UTC(y, m - 2, 1));
      const prevEnd   = new Date(Date.UTC(y, m - 1, 0, 23, 59, 59, 999));
      return { start, end, label: RANGE_LABELS.last_month, previous: { start: prevStart, end: prevEnd } };
    }

    case "this_semester": {
      // S1 = ene-jun, S2 = jul-dic
      const isS1 = m < 6;
      const semStart = new Date(Date.UTC(y, isS1 ? 0 : 6, 1));
      const semEnd   = endOfDay(today);
      // Período previo: semestre completo anterior
      const prevStart = isS1
        ? new Date(Date.UTC(y - 1, 6, 1))  // S2 del año pasado
        : new Date(Date.UTC(y, 0, 1));       // S1 de este año
      const prevEnd = isS1
        ? new Date(Date.UTC(y - 1, 12, 0, 23, 59, 59, 999)) // fin dic año pasado
        : new Date(Date.UTC(y, 6, 0, 23, 59, 59, 999));      // fin jun este año
      return { start: semStart, end: semEnd, label: RANGE_LABELS.this_semester, previous: { start: prevStart, end: prevEnd } };
    }

    case "last_semester": {
      const isCurrentS1 = m < 6;
      // Semestre pasado
      const lastSemStart = isCurrentS1
        ? new Date(Date.UTC(y - 1, 6, 1))   // S2 del año pasado
        : new Date(Date.UTC(y, 0, 1));        // S1 de este año
      const lastSemEnd = isCurrentS1
        ? new Date(Date.UTC(y - 1, 12, 0, 23, 59, 59, 999))
        : new Date(Date.UTC(y, 6, 0, 23, 59, 59, 999));
      // Semestre previo al pasado
      const prevStart = isCurrentS1
        ? new Date(Date.UTC(y - 1, 0, 1))   // S1 del año pasado
        : new Date(Date.UTC(y - 1, 6, 1));   // S2 del año pasado
      const prevEnd = isCurrentS1
        ? new Date(Date.UTC(y - 1, 6, 0, 23, 59, 59, 999))
        : new Date(Date.UTC(y - 1, 12, 0, 23, 59, 59, 999));
      return { start: lastSemStart, end: lastSemEnd, label: RANGE_LABELS.last_semester, previous: { start: prevStart, end: prevEnd } };
    }

    case "this_year": {
      const start     = new Date(Date.UTC(y, 0, 1));
      const end       = endOfDay(today);
      const prevStart = new Date(Date.UTC(y - 1, 0, 1));
      const prevEnd   = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));
      return { start, end, label: RANGE_LABELS.this_year, previous: { start: prevStart, end: prevEnd } };
    }

    case "last_year": {
      const start     = new Date(Date.UTC(y - 1, 0, 1));
      const end       = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));
      const prevStart = new Date(Date.UTC(y - 2, 0, 1));
      const prevEnd   = new Date(Date.UTC(y - 2, 11, 31, 23, 59, 59, 999));
      return { start, end, label: RANGE_LABELS.last_year, previous: { start: prevStart, end: prevEnd } };
    }
  }
}

// Suprime linting de variable no usada
void lastDayOfPrevMonth;
void startOfDay;

export function isValidRangeKey(k: string): k is RangeKey {
  return (k as RangeKey) in RANGE_LABELS;
}
