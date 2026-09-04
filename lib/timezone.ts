// Offset horario del negocio (Chile, sin horario de verano desde 2019).
// Todo cálculo de "qué día calendario es hoy" para reglas de negocio —
// rangos de fecha de los reportes ("Hoy", "Este mes", etc.) y el bucketing
// de llamadas de Allo por día — debe usar este mismo offset en vez del día
// UTC del servidor. Si en el futuro se opera con clientes en otro huso
// horario, esto debe volverse configurable por número/cliente en vez de un
// offset fijo (mismo caso que COUNTRY_NAME_ALIASES en sdrAnalytics.ts).
export const CHILE_UTC_OFFSET_HOURS = -4;

// Traslada un instante para que sus getters UTC (getUTCFullYear,
// getUTCMonth, getUTCDate, getUTCDay, etc.) devuelvan la fecha/hora en
// horario de Chile — es un truco para reusar los getters UTC de Date como
// si fueran locales a Chile, no representa un instante real.
export function toChileParts(d: Date): Date {
  return new Date(d.getTime() + CHILE_UTC_OFFSET_HOURS * 3600000);
}
