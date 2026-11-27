import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isTrialPlan,
  monthlyCompanyQuota,
  monthProgress,
  trialState,
  type ActiConfig,
  type ActiPlan,
  type TrialState,
} from "@/lib/acti/plans";
import type { ActiMember } from "@/lib/acti/server";

// ACTI · datos de la pantalla de Inicio del socio. Solo LECTURA de tablas
// existentes (meetings, meeting_feedback, client_wishlist) filtradas por el
// client_id de la sesión.

// Día de hoy en Chile (YYYY-MM-DD)
export function chileToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function monthBounds(todayIso: string) {
  const [y, m] = todayIso.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, next };
}

type MeetingRow = {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  correo: string | null;
  telefono: string | null;
  fecha_reunion: string | null;
  hora: string | null;
  realizado: string | null;
};

// Reunión agendada: el socio ve nombre, cargo, correo y teléfono del contacto
// (decisión de BullsEye 27-nov-2026). Antes de agendar, nunca.
export type UpcomingMeeting = {
  id: string;
  company: string;
  date: string | null;
  time: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type PendingFeedback = { id: string; company: string; date: string | null; contactTitle: string | null };

export type ActiHome = {
  today: string;
  planId: string;
  planName: string;
  isTrial: boolean;
  trial: TrialState | null;
  month: ReturnType<typeof monthProgress> & { noShows: number; companyQuota: number; companiesRequested: number };
  upcoming: UpcomingMeeting[];
  pendingFeedback: PendingFeedback[];
};

// Estados de la planilla de reuniones: Si / No / Pendiente / Reagendar
const COUNTS_AS_MEETING = new Set(["Si", "Pendiente", "Reagendar"]);
// Empresas pedidas que cuentan para el tope (no las propuestas sin responder ni las rechazadas)
const NOT_REQUESTED = new Set(["proposed", "rejected_by_client"]);

export async function loadActiHome(
  db: SupabaseClient,
  clientId: string,
  member: ActiMember,
  plan: ActiPlan,
  config: ActiConfig,
  now = new Date()
): Promise<ActiHome> {
  const today = chileToday(now);
  const { start: mStart, next: mNext } = monthBounds(today);
  const trial = isTrialPlan(plan);
  const since = trial ? (member.trial_start || member.joined_at) : mStart;
  const from = since < mStart ? since : mStart;

  const [{ data: meetings }, { data: wishlist }] = await Promise.all([
    db
      .from("meetings")
      .select("id, empresa, contacto_nombre, contacto_cargo, correo, telefono, fecha_reunion, hora, realizado")
      .eq("client_id", clientId)
      .gte("fecha_reunion", from < addDays(today, -90) ? from : addDays(today, -90))
      .order("fecha_reunion", { ascending: true })
      .limit(2000),
    db
      .from("client_wishlist")
      .select("status, created_at")
      .eq("client_id", clientId)
      .gte("created_at", `${from}T00:00:00Z`)
      .limit(5000),
  ]);
  const ms = (meetings ?? []) as MeetingRow[];
  const wl = (wishlist ?? []) as { status: string; created_at: string }[];

  // Mes en curso (por fecha de la reunión, como el Excel de metas)
  const inMonth = ms.filter((m) => m.fecha_reunion && m.fecha_reunion >= mStart && m.fecha_reunion < mNext);
  const done = inMonth.filter((m) => m.realizado === "Si").length;
  const scheduled = inMonth.filter((m) => m.realizado === "Pendiente" || m.realizado === "Reagendar").length;
  const noShows = inMonth.filter((m) => m.realizado === "No").length;
  const companiesRequested = wl.filter((w) => w.created_at.slice(0, 10) >= mStart && !NOT_REQUESTED.has(w.status)).length;

  let trialInfo: TrialState | null = null;
  if (trial) {
    const meetingsUsed = ms.filter((m) => m.fecha_reunion && m.fecha_reunion >= since && COUNTS_AS_MEETING.has(m.realizado ?? "")).length;
    const companiesUsed = wl.filter((w) => w.created_at.slice(0, 10) >= since && !NOT_REQUESTED.has(w.status)).length;
    trialInfo = trialState(member, plan, { meetings: meetingsUsed, companies: companiesUsed }, today);
  }

  const upcoming = ms
    .filter((m) => m.fecha_reunion && m.fecha_reunion >= today && (m.realizado === "Pendiente" || m.realizado === "Reagendar"))
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      company: m.empresa,
      date: m.fecha_reunion,
      time: m.hora,
      contactName: m.contacto_nombre,
      contactTitle: m.contacto_cargo,
      contactEmail: m.correo,
      contactPhone: m.telefono,
    }));

  // Feedback pendiente: realizadas de los últimos 60 días sin encuesta
  const recentDone = ms.filter((m) => m.realizado === "Si" && m.fecha_reunion && m.fecha_reunion >= addDays(today, -60) && m.fecha_reunion <= today);
  let pendingFeedback: PendingFeedback[] = [];
  if (recentDone.length) {
    const { data: fb } = await db.from("meeting_feedback").select("meeting_id").in("meeting_id", recentDone.map((m) => m.id));
    const withFb = new Set((fb ?? []).map((f: { meeting_id: string }) => f.meeting_id));
    pendingFeedback = recentDone
      .filter((m) => !withFb.has(m.id))
      .reverse()
      .slice(0, 5)
      .map((m) => ({ id: m.id, company: m.empresa, date: m.fecha_reunion, contactTitle: m.contacto_cargo }));
  }

  return {
    today,
    planId: plan.id,
    planName: plan.name,
    isTrial: trial,
    trial: trialInfo,
    month: { ...monthProgress(plan, done, scheduled), noShows, companyQuota: monthlyCompanyQuota(plan, config.params), companiesRequested },
    upcoming,
    pendingFeedback,
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
