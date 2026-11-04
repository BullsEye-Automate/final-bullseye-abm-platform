// Meta del mes por cliente para el Reporte SDR diario (confirmado con
// BullsEye, nov-2026):
// - Clientes: TODOS los que tienen meta cargada en el mes (pestaña
//   "Asignación"; meta del cliente = suma de las metas de sus SDR). Las
//   cuentas que comparten ID Cliente (Nisum Colombia, CChC - Valle…) van por
//   separado, igual que en Células SDR.
// - Realizadas = Realizado "Si" con fecha de reunión en el mes; Por realizar =
//   "Pendiente" con fecha de reunión en el mes (solo informativo).
// - Faltan = meta − realizadas: una reunión que aún no ocurre no cuenta.
// - Semáforo = días HÁBILES (lun–vie sin feriados de Chile) desde la última
//   reunión AGENDADA del cliente (fecha de agendamiento, cualquier estado):
//   verde ≤ 2, amarillo 3–5, rojo ≥ 6 o sin reuniones agendadas en la
//   ventana cargada (3 meses).
// Reutiliza loadBase de Células SDR, así que metas, cuentas y exclusiones
// (Adolfo, José Pablo) calzan con ese módulo.
import { loadBase } from "@/lib/celulasSdr/server/base";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";
import { businessDaysBetween, addDays } from "@/lib/celulasSdr/calendar";

export const IDLE_THRESHOLDS = { green: 2, yellow: 5 }; // ≤2 verde · 3–5 amarillo · ≥6 rojo

export type IdleLevel = "g" | "y" | "r";

export type ClientGoalRow = {
  client: string;          // nombre del cliente (o de la cuenta)
  goal: number;            // meta del mes
  held: number;            // realizadas en el mes
  pending: number;         // por realizar en el mes (Pendiente)
  remaining: number;       // max(0, meta − realizadas)
  today: number;           // reuniones agendadas hoy
  lastScheduled: string | null; // última fecha de agendamiento (YYYY-MM-DD)
  idleDays: number | null; // días hábiles desde la última agendada (0 = hoy; null = sin reuniones)
  level: IdleLevel;
};

export type ClientGoals = { month: string; rows: ClientGoalRow[] };

export function idleLevel(days: number | null): IdleLevel {
  if (days === null || days > IDLE_THRESHOLDS.yellow) return "r";
  return days > IDLE_THRESHOLDS.green ? "y" : "g";
}

// Días hábiles transcurridos después de `from` hasta `to` inclusive
// (agendada hoy = 0; agendada el día hábil anterior = 1).
function businessDaysSince(from: string, to: string): number {
  if (from >= to) return 0;
  return businessDaysBetween(addDays(from, 1), to).length;
}

export async function buildClientGoals(day: string): Promise<ClientGoals> {
  const month = day.slice(0, 7);
  const base = await loadBase(month);
  const names = new Map(base.clients.map((c) => [c.id, c.name]));

  const goal = new Map<string, number>();
  for (const g of base.goals) {
    if (g.month !== month || isExcludedSdr(g.sdr)) continue;
    goal.set(g.client, (goal.get(g.client) ?? 0) + g.goal);
  }
  const held = new Map<string, number>();
  const pending = new Map<string, number>();
  const today = new Map<string, number>();
  const last = new Map<string, string>();
  for (const m of base.meetings) {
    if (!m.client || isExcludedSdr(m.sdr)) continue;
    if (m.st === "held" && m.md?.startsWith(month)) held.set(m.client, (held.get(m.client) ?? 0) + 1);
    if (m.st === "pending" && m.md?.startsWith(month)) pending.set(m.client, (pending.get(m.client) ?? 0) + 1);
    if (m.sd === day) today.set(m.client, (today.get(m.client) ?? 0) + 1);
    if (m.sd && m.sd <= day && (!last.has(m.client) || m.sd > last.get(m.client)!)) last.set(m.client, m.sd);
  }

  const rows: ClientGoalRow[] = [];
  for (const [id, g] of goal) {
    if (!(g > 0)) continue;
    const gl = Math.round(g * 10) / 10;
    const h = held.get(id) ?? 0;
    const ls = last.get(id) ?? null;
    const idle = ls ? businessDaysSince(ls, day) : null;
    rows.push({
      client: names.get(id) ?? "Cliente desconocido",
      goal: gl,
      held: h,
      pending: pending.get(id) ?? 0,
      remaining: Math.max(0, Math.ceil(gl - h)),
      today: today.get(id) ?? 0,
      lastScheduled: ls,
      idleDays: idle,
      level: idleLevel(idle),
    });
  }
  // Rojos primero (más días sin reunión arriba), luego amarillos y verdes;
  // dentro de cada color, a quien más le falta.
  const rank: Record<IdleLevel, number> = { r: 0, y: 1, g: 2 };
  rows.sort(
    (a, b) =>
      rank[a.level] - rank[b.level] ||
      (b.idleDays ?? 9999) - (a.idleDays ?? 9999) ||
      b.remaining - a.remaining ||
      a.client.localeCompare(b.client, "es")
  );
  return { month, rows };
}
