import type { SupabaseClient } from "@supabase/supabase-js";
import { isTrialPlan, monthlyCompanyQuota, trialState, type ActiPlan, type ActiParams, type TrialState } from "@/lib/acti/plans";
import type { ActiMember } from "@/lib/acti/server";
import { chileToday, monthBounds } from "@/lib/acti/home";

// ACTI · cupo de empresas del socio. Planes pagados: empresas del mes =
// reuniones garantizadas ÷ conversión. Freemium: 20 empresas o 2 reuniones en
// 90 días, lo que ocurra primero (al completarse, se bloquean nuevas solicitudes).

export type Quota = {
  period: "month" | "trial";
  since: string;
  limit: number;
  used: number;           // solicitudes del período (cola + liberadas)
  remaining: number;
  blocked: boolean;
  reason: string | null;  // mensaje claro para el socio
  trial: TrialState | null;
};

const COUNTS_AS_MEETING = ["Si", "Pendiente", "Reagendar"];

export function currentMonth(today = chileToday()) {
  return today.slice(0, 7);
}

export async function loadQuota(db: SupabaseClient, clientId: string, member: ActiMember, plan: ActiPlan, params: ActiParams): Promise<Quota> {
  const today = chileToday();
  const trial = isTrialPlan(plan);
  const since = trial ? member.trial_start || member.joined_at : monthBounds(today).start;
  const limit = monthlyCompanyQuota(plan, params);

  const { count } = await db
    .from("acti_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .neq("status", "cancelada")
    .gte("created_at", `${since}T00:00:00-03:00`);
  const used = count ?? 0;

  let trialInfo: TrialState | null = null;
  let reason: string | null = null;
  if (trial) {
    const { count: meetings } = await db
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("fecha_reunion", since)
      .in("realizado", COUNTS_AS_MEETING);
    trialInfo = trialState(member, plan, { meetings: meetings ?? 0, companies: used }, today);
    if (trialInfo.completed) {
      reason =
        trialInfo.reason === "meetings"
          ? `Completaste tu prueba: ya tuviste ${trialInfo.meetingsLimit} reuniones. Pasa a un plan pagado para seguir pidiendo empresas.`
          : trialInfo.reason === "companies"
            ? `Completaste tu prueba: ya pediste ${trialInfo.companiesLimit} empresas. Pasa a un plan pagado para seguir.`
            : "Terminó la ventana de 90 días de tu prueba. Pasa a un plan pagado para seguir pidiendo empresas.";
    }
  } else if (member.status === "pausado" || member.status === "baja") {
    reason = "Tu plan está pausado. Conversa con el equipo de BullsEye para reactivarlo.";
  } else if (used >= limit) {
    reason = `Ya pediste las ${limit} empresas de este mes, las necesarias para cumplir tu garantía. El próximo mes se renueva el cupo.`;
  }

  return {
    period: trial ? "trial" : "month",
    since,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    blocked: !!reason,
    reason,
    trial: trialInfo,
  };
}
