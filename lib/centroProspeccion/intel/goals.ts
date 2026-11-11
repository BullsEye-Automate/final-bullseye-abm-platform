import { supabaseAdmin } from "@/lib/supabase";
import { loadBase } from "@/lib/celulasSdr/server/base";
import { isExcludedSdr } from "@/lib/celulasSdr/engine";
import { businessDaysBetween, addDays } from "@/lib/celulasSdr/calendar";

// Meta de reuniones del mes por cliente para la Inteligencia de la semana.
// Mismo criterio que el Reporte SDR (lib/reporteSdr/goals.ts) y Células SDR:
// meta = suma de las metas de sus SDR en la pestaña "Asignación"; realizadas
// = Realizado "Si" con fecha de reunión en el mes; por realizar = "Pendiente"
// con fecha de reunión en el mes; faltan = meta − realizadas. Las cuentas que
// comparten ID Cliente (Nisum Colombia, CChC - Valle…) se suman al cliente
// del portal. Se calcula una vez al día para todos y se guarda en
// allo_response_cache (lo comparten las invocaciones por cliente del cron).

export type ClientGoal = {
  mes: string;                 // AAAA-MM
  meta: number;
  realizadas: number;
  porRealizar: number;         // Pendiente con fecha de reunión en el mes
  agendadasMes: number;        // agendadas en el mes (fecha de agendamiento)
  faltan: number;              // max(0, meta − realizadas)
  cumplida: boolean;
  diasHabilesMes: number;
  diasHabilesRestantes: number; // desde hoy (incluido) al fin de mes
  cuentas: string[];           // nombres de las cuentas sumadas
};

const cacheKey = (day: string) => `centro_intel_goals:${day}`;

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function loadGoalsByClient(day: string): Promise<Record<string, ClientGoal>> {
  const db = supabaseAdmin();
  const { data: cached } = await db.from("allo_response_cache").select("response, expires_at").eq("cache_key", cacheKey(day)).maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() > Date.now()) return cached.response as Record<string, ClientGoal>;

  const month = day.slice(0, 7);
  const base = await loadBase(month);
  const names = new Map(base.clients.map((c) => [c.id, c.name]));
  const baseId = (k: string) => k.split("~")[0];
  const out: Record<string, ClientGoal> = {};
  const get = (key: string) => {
    const id = baseId(key);
    if (!out[id]) {
      const first = addDays(month + "-01", 0);
      out[id] = {
        mes: month, meta: 0, realizadas: 0, porRealizar: 0, agendadasMes: 0, faltan: 0, cumplida: false,
        diasHabilesMes: businessDaysBetween(first, monthEnd(month)).length,
        diasHabilesRestantes: day <= monthEnd(month) ? businessDaysBetween(day, monthEnd(month)).length : 0,
        cuentas: [],
      };
    }
    const n = names.get(key);
    if (n && !out[id].cuentas.includes(n)) out[id].cuentas.push(n);
    return out[id];
  };
  for (const g of base.goals) {
    if (g.month !== month || isExcludedSdr(g.sdr) || !g.client) continue;
    get(g.client).meta += g.goal;
  }
  for (const m of base.meetings) {
    if (!m.client || isExcludedSdr(m.sdr)) continue;
    const id = baseId(m.client);
    if (!out[id]) continue; // solo clientes con meta este mes
    const r = out[id];
    if (m.st === "held" && m.md?.startsWith(month)) r.realizadas++;
    if (m.st === "pending" && m.md?.startsWith(month)) r.porRealizar++;
    if (m.sd?.startsWith(month)) r.agendadasMes++;
  }
  for (const r of Object.values(out)) {
    r.meta = Math.round(r.meta * 10) / 10;
    r.faltan = Math.max(0, Math.ceil(r.meta - r.realizadas));
    r.cumplida = r.meta > 0 && r.realizadas >= r.meta;
  }
  await db.from("allo_response_cache").upsert({ cache_key: cacheKey(day), response: out, expires_at: new Date(Date.now() + 20 * 3_600_000).toISOString() });
  return out;
}

// Tope de empresas sugeridas cuando el cliente ya cumplió la meta del mes:
// se baja el ritmo, pero se deja un mínimo para que los SDR no se queden sin
// cuentas al empezar el mes siguiente.
export const MET_GOAL_CAP = 10;

export function goalText(g: ClientGoal | null | undefined): string {
  if (!g) return "Sin meta de reuniones cargada para este mes en la pestaña Asignación.";
  return [
    `Meta de reuniones de ${g.mes}: ${g.meta}. Realizadas: ${g.realizadas}. Por realizar (agendadas para este mes, aún pendientes): ${g.porRealizar}. Faltan: ${g.faltan}.`,
    `Agendadas en el mes: ${g.agendadasMes}. Días hábiles que quedan en el mes: ${g.diasHabilesRestantes} de ${g.diasHabilesMes}.`,
    g.cumplida ? "LA META DEL MES YA ESTÁ CUMPLIDA." : g.faltan > g.porRealizar ? `Aunque se realicen todas las pendientes, faltarían ${g.faltan - g.porRealizar} reuniones.` : "Si se realizan las pendientes, la meta se cumple.",
  ].join("\n");
}
