// Avance de la meta mensual por cliente para el Reporte SDR diario
// (confirmado con BullsEye, nov-2026): solo los clientes con reuniones
// agendadas hoy; meta = suma de las metas de sus SDR en la pestaña
// "Asignación" del mes; avance = reuniones REALIZADAS (Realizado = Si) con
// fecha de reunión en el mes — el mismo criterio de cumplimiento de Células
// SDR. Reutiliza loadBase de Células SDR (metas, cuentas que comparten ID
// Cliente y reuniones ya resueltas), así que los números calzan con ese
// módulo. Excluidos: los mismos de Células SDR (Adolfo, José Pablo).
import { loadBase } from "@/lib/celulasSdr/server/base";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";

export type ClientGoalRow = {
  client: string;          // nombre del cliente (o de la cuenta)
  goal: number;            // meta del mes (0 = sin meta cargada)
  held: number;            // realizadas en el mes
  remaining: number;       // max(0, goal - held)
  today: number;           // reuniones agendadas hoy
};

export type ClientGoals = { month: string; rows: ClientGoalRow[] };

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
  const today = new Map<string, number>();
  for (const m of base.meetings) {
    if (!m.client || isExcludedSdr(m.sdr)) continue;
    if (m.st === "held" && m.md?.startsWith(month)) held.set(m.client, (held.get(m.client) ?? 0) + 1);
    if (m.sd === day) today.set(m.client, (today.get(m.client) ?? 0) + 1);
  }

  const rows: ClientGoalRow[] = [...today.entries()].map(([id, n]) => {
    const gl = Math.round((goal.get(id) ?? 0) * 10) / 10;
    const h = held.get(id) ?? 0;
    return { client: names.get(id) ?? "Cliente desconocido", goal: gl, held: h, remaining: Math.max(0, Math.ceil(gl - h)), today: n };
  });
  // Primero los que más les falta; los sin meta al final.
  rows.sort((a, b) => (a.goal ? 0 : 1) - (b.goal ? 0 : 1) || b.remaining - a.remaining || a.client.localeCompare(b.client, "es"));
  return { month, rows };
}
