import { isTrialPlan, type ActiParams, type ActiPlan, type ActiStatus } from "@/lib/acti/plans";

// ACTI · facturación del mes (funciones puras: las usan el servidor, las
// páginas y las pruebas).
//
// Reglas (encargo + decisiones de BullsEye):
//  - Base mensual del plan + UF por reunión, más IVA.
//  - Variable por reunión REALIZADA (configurable: "agendada"). Las reuniones
//    a las que el prospecto no asiste (no-show) no se cobran.
//  - Si el socio dice que una reunión no se realizó y la planilla dice que sí,
//    queda "en revisión" y no se cobra hasta que el equipo la resuelva.
//  - Las reuniones de eventos de ACTI no consumen cupo ni se cobran (viven en
//    otra tabla, no en `meetings`).
//  - Freemium: $0. Pausado o dado de baja: sin base.
//  - Revenue share ACTI: % de la base mensual (no del variable).

export type BillMeeting = {
  id: string;
  empresa: string;
  fecha_reunion: string | null;
  fecha_agendamiento?: string | null;
  realizado: string | null;            // Si | No | Pendiente | Reagendar
  disputa?: "en_revision" | "cobrar" | "no_cobrar" | null;
};

export type BillLine = { id: string; empresa: string; fecha: string | null; estado: "cobrada" | "no_show" | "en_revision" | "sin_cargo" };

export type Bill = {
  month: string;
  plan: string;
  free: boolean;
  baseUf: number;
  perMeetingUf: number;
  meetingsCharged: number;
  meetingsDone: number;
  meetingsNoShow: number;
  meetingsDisputed: number;
  variableUf: number;
  subtotalUf: number;
  ivaPct: number;
  ivaUf: number;
  totalUf: number;
  revenueSharePct: number;
  revenueShareUf: number;
  lines: BillLine[];
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const inMonth = (d: string | null | undefined, month: string) => !!d && d.slice(0, 7) === month;

export function computeBill(plan: ActiPlan, params: ActiParams, status: ActiStatus, meetings: BillMeeting[], month: string): Bill {
  const free = isTrialPlan(plan) || (plan.baseUf === 0 && plan.perMeetingUf === 0);
  const active = status === "activo" || status === "en_prueba";
  const baseUf = free || !active ? 0 : plan.baseUf;
  const perMeetingUf = free ? 0 : plan.perMeetingUf;
  const byAgenda = params.chargeVariableOn === "agendada";

  const lines: BillLine[] = [];
  let charged = 0, done = 0, noShow = 0, disputed = 0;
  for (const m of meetings) {
    // Período: por fecha de la reunión (realizada) o de agendamiento (agendada)
    const relevant = byAgenda ? inMonth(m.fecha_agendamiento, month) : inMonth(m.fecha_reunion, month);
    if (!relevant) continue;
    const fecha = (byAgenda ? m.fecha_agendamiento : m.fecha_reunion) ?? null;
    if (m.realizado === "No") {
      noShow++;
      lines.push({ id: m.id, empresa: m.empresa, fecha, estado: "no_show" });
      continue;
    }
    const counts = byAgenda ? ["Si", "Pendiente", "Reagendar"].includes(m.realizado ?? "") : m.realizado === "Si";
    if (!counts) continue;
    if (m.realizado === "Si") done++;
    if (m.disputa === "en_revision" || m.disputa === "no_cobrar") {
      disputed++;
      lines.push({ id: m.id, empresa: m.empresa, fecha, estado: m.disputa === "no_cobrar" ? "sin_cargo" : "en_revision" });
      continue;
    }
    charged++;
    lines.push({ id: m.id, empresa: m.empresa, fecha, estado: free ? "sin_cargo" : "cobrada" });
  }

  const variableUf = round2(perMeetingUf * charged);
  const subtotalUf = round2(baseUf + variableUf);
  const ivaUf = round2(subtotalUf * (params.ivaPct / 100));
  return {
    month,
    plan: plan.id,
    free,
    baseUf,
    perMeetingUf,
    meetingsCharged: free ? 0 : charged,
    meetingsDone: done,
    meetingsNoShow: noShow,
    meetingsDisputed: disputed,
    variableUf,
    subtotalUf,
    ivaPct: params.ivaPct,
    ivaUf,
    totalUf: round2(subtotalUf + ivaUf),
    revenueSharePct: params.revenueSharePct,
    revenueShareUf: round2(baseUf * (params.revenueSharePct / 100)),
    lines: lines.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "")),
  };
}

export const toClp = (uf: number, ufValue: number | null) => (ufValue ? Math.round(uf * ufValue) : null);

// Mes anterior a uno dado ('YYYY-MM')
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// Último día de un mes ('YYYY-MM' → 'YYYY-MM-DD')
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
