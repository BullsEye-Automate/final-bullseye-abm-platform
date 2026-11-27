// ACTI · Red de Negocios — planes y reglas de negocio.
//
// Funciones puras (sin Supabase ni Node): las usan el servidor, las páginas
// y las pruebas. Los valores reales salen de la configuración editable
// (tabla acti_config, clave 'plans'); acá están solo los valores por defecto
// y la validación. Cambiar un plan NO requiere tocar código.

export type ActiPlanId = "freemium" | "conecta" | "crece" | "acelera";
export const PLAN_IDS: ActiPlanId[] = ["freemium", "conecta", "crece", "acelera"];

export type ActiStatus = "activo" | "en_prueba" | "pausado" | "baja";
export const STATUS_IDS: ActiStatus[] = ["activo", "en_prueba", "pausado", "baja"];
export const STATUS_LABEL: Record<ActiStatus, string> = {
  activo: "Activo",
  en_prueba: "En prueba",
  pausado: "Pausado",
  baja: "Dado de baja",
};

// Vistas de Pulso ABM (slugs de lib/radarAbm/render.ts) que el socio puede ver
export const PULSO_VIEW_OPTIONS: { slug: string; label: string }[] = [
  { slug: "vision-ejecutiva", label: "Visión ejecutiva" },
  { slug: "cuentas-objetivo", label: "Cuentas objetivo" },
  { slug: "avance-cuentas", label: "Avance en cuentas" },
  { slug: "reuniones", label: "Reuniones" },
  { slug: "feedback-manual", label: "Feedback" },
  { slug: "peitho", label: "Peitho" },
  { slug: "voz-mercado", label: "Voz del mercado" },
  { slug: "icp-proyecto", label: "ICP del proyecto" },
];

export type ActiPlan = {
  id: ActiPlanId;
  name: string;
  baseUf: number;               // base mensual (UF, sin IVA)
  perMeetingUf: number;         // variable por reunión (UF, sin IVA)
  guaranteedMeetings: number;   // reuniones garantizadas al mes (0 en Freemium)
  // Freemium: topes de la prueba completa (no mensuales)
  trialMeetings: number;
  trialCompanies: number;
  trialDays: number;
  // Tope mensual de empresas: null = se calcula con la conversión
  companiesPerMonth: number | null;
  replacesNoResponse: boolean;  // las cuentas sin respuesta se reemplazan
  hasKam: boolean;              // KAM dedicado (desde Crece)
  priority: number;             // mayor = antes en la cola de prospección
  pulsoViews: string[];         // vistas de Pulso ABM visibles
  pulsoShowContacts: boolean;   // Pulso con nombres de contactos (como un cliente directo)
  description: string;
};

export type ActiParams = {
  conversionRate: number;       // reuniones / empresas trabajadas (referencia)
  noResponseAttempts: number;   // intentos antes de declarar "sin respuesta"
  noResponseBusinessDays: number;
  revenueSharePct: number;      // % de la base mensual para ACTI
  ivaPct: number;
  chargeVariableOn: "realizada" | "agendada";
  queueReleasePerRun: number;   // solicitudes que pasan de la cola ACTI a la prospección cada 15 min
};

export type ActiConfig = { plans: Record<ActiPlanId, ActiPlan>; params: ActiParams };

const VIEWS_CONECTA = ["vision-ejecutiva", "reuniones"];
const VIEWS_CRECE = [...VIEWS_CONECTA, "avance-cuentas", "feedback-manual", "icp-proyecto", "peitho"];

export const DEFAULT_CONFIG: ActiConfig = {
  plans: {
    freemium: {
      id: "freemium", name: "Freemium", baseUf: 0, perMeetingUf: 0, guaranteedMeetings: 0,
      trialMeetings: 2, trialCompanies: 20, trialDays: 90, companiesPerMonth: null,
      replacesNoResponse: false, hasKam: false, priority: 0, pulsoViews: [], pulsoShowContacts: false,
      description: "Incluido en la membresía ACTI. Prueba de 90 días: hasta 20 empresas o 2 reuniones, lo que ocurra primero.",
    },
    conecta: {
      id: "conecta", name: "Conecta", baseUf: 18, perMeetingUf: 4, guaranteedMeetings: 5,
      trialMeetings: 0, trialCompanies: 0, trialDays: 0, companiesPerMonth: null,
      // KAM dedicado desde Crece (decisión de BullsEye 27-nov-2026)
      replacesNoResponse: true, hasKam: false, priority: 1, pulsoViews: VIEWS_CONECTA, pulsoShowContacts: false,
      description: "5 reuniones garantizadas al mes, con soporte del equipo BullsEye.",
    },
    crece: {
      id: "crece", name: "Crece", baseUf: 26, perMeetingUf: 4, guaranteedMeetings: 8,
      trialMeetings: 0, trialCompanies: 0, trialDays: 0, companiesPerMonth: null,
      replacesNoResponse: true, hasKam: true, priority: 2, pulsoViews: VIEWS_CRECE, pulsoShowContacts: false,
      description: "8 reuniones garantizadas al mes, con KAM dedicado y Peitho.",
    },
    acelera: {
      id: "acelera", name: "Acelera", baseUf: 35, perMeetingUf: 4, guaranteedMeetings: 12,
      trialMeetings: 0, trialCompanies: 0, trialDays: 0, companiesPerMonth: null,
      replacesNoResponse: true, hasKam: true, priority: 3,
      pulsoViews: PULSO_VIEW_OPTIONS.map((v) => v.slug), pulsoShowContacts: true,
      description: "12 reuniones garantizadas al mes, con KAM dedicado y Pulso ABM completo.",
    },
  },
  params: {
    conversionRate: 0.1,
    noResponseAttempts: 6,
    noResponseBusinessDays: 10,
    revenueSharePct: 10,
    ivaPct: 19,
    chargeVariableOn: "realizada",
    queueReleasePerRun: 25,
  },
};

// ── Validación / normalización de la config guardada ────────────────────

const num = (v: unknown, def: number, min = 0, max = 1e6) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
const str = (v: unknown, def: string, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : def);

// Mezcla lo guardado sobre los valores por defecto: una clave faltante o
// inválida toma el valor por defecto (nunca rompe la página).
export function normalizeConfig(raw: unknown): ActiConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rp = (r.plans && typeof r.plans === "object" ? r.plans : {}) as Record<string, unknown>;
  const plans = {} as Record<ActiPlanId, ActiPlan>;
  const validViews = new Set(PULSO_VIEW_OPTIONS.map((v) => v.slug));
  for (const id of PLAN_IDS) {
    const d = DEFAULT_CONFIG.plans[id];
    const p = (rp[id] && typeof rp[id] === "object" ? rp[id] : {}) as Record<string, unknown>;
    plans[id] = {
      id,
      name: str(p.name, d.name, 40),
      baseUf: num(p.baseUf, d.baseUf, 0, 10000),
      perMeetingUf: num(p.perMeetingUf, d.perMeetingUf, 0, 1000),
      guaranteedMeetings: Math.round(num(p.guaranteedMeetings, d.guaranteedMeetings, 0, 500)),
      trialMeetings: Math.round(num(p.trialMeetings, d.trialMeetings, 0, 500)),
      trialCompanies: Math.round(num(p.trialCompanies, d.trialCompanies, 0, 5000)),
      trialDays: Math.round(num(p.trialDays, d.trialDays, 0, 3650)),
      companiesPerMonth: p.companiesPerMonth === null || p.companiesPerMonth === undefined || p.companiesPerMonth === ""
        ? d.companiesPerMonth
        : Math.round(num(p.companiesPerMonth, d.companiesPerMonth ?? 0, 0, 5000)),
      replacesNoResponse: bool(p.replacesNoResponse, d.replacesNoResponse),
      hasKam: bool(p.hasKam, d.hasKam),
      priority: Math.round(num(p.priority, d.priority, 0, 100)),
      pulsoViews: Array.isArray(p.pulsoViews)
        ? (p.pulsoViews as unknown[]).filter((s): s is string => typeof s === "string" && validViews.has(s))
        : d.pulsoViews,
      pulsoShowContacts: bool(p.pulsoShowContacts, d.pulsoShowContacts),
      description: str(p.description, d.description, 500),
    };
  }
  const pr = (r.params && typeof r.params === "object" ? r.params : {}) as Record<string, unknown>;
  const dp = DEFAULT_CONFIG.params;
  const params: ActiParams = {
    conversionRate: num(pr.conversionRate, dp.conversionRate, 0.01, 1),
    noResponseAttempts: Math.round(num(pr.noResponseAttempts, dp.noResponseAttempts, 1, 50)),
    noResponseBusinessDays: Math.round(num(pr.noResponseBusinessDays, dp.noResponseBusinessDays, 1, 90)),
    revenueSharePct: num(pr.revenueSharePct, dp.revenueSharePct, 0, 100),
    ivaPct: num(pr.ivaPct, dp.ivaPct, 0, 100),
    chargeVariableOn: pr.chargeVariableOn === "agendada" ? "agendada" : "realizada",
    queueReleasePerRun: Math.round(num(pr.queueReleasePerRun, dp.queueReleasePerRun, 1, 500)),
  };
  return { plans, params };
}

// ── Reglas ───────────────────────────────────────────────────────────────

export const isTrialPlan = (plan: ActiPlan) => plan.guaranteedMeetings === 0 && plan.trialDays > 0;

// Empresas a trabajar en el mes para cumplir la garantía: reuniones ÷ conversión.
// Ej.: 5 reuniones ÷ 10% = 50 empresas.
export function monthlyCompanyQuota(plan: ActiPlan, params: ActiParams): number {
  if (isTrialPlan(plan)) return plan.trialCompanies;
  if (plan.companiesPerMonth !== null) return plan.companiesPerMonth;
  if (plan.guaranteedMeetings <= 0) return 0;
  return Math.ceil(plan.guaranteedMeetings / params.conversionRate - 1e-9);
}

// Ventana de la prueba: desde trial_start (o la fecha de alta) por trialDays
export function trialWindow(member: { trial_start: string | null; trial_end: string | null; joined_at: string }, plan: ActiPlan) {
  const start = member.trial_start || member.joined_at;
  let end = member.trial_end;
  if (!end) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + plan.trialDays);
    end = d.toISOString().slice(0, 10);
  }
  return { start, end };
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export type TrialState = {
  start: string;
  end: string;
  daysLeft: number;
  meetingsUsed: number;
  companiesUsed: number;
  meetingsLimit: number;
  companiesLimit: number;
  // completada = llegó a un tope o venció la ventana: bloquea nuevas solicitudes
  completed: boolean;
  reason: "meetings" | "companies" | "expired" | null;
};

// "Hasta 20 empresas o 2 reuniones, lo que ocurra primero", en 90 días
export function trialState(
  member: { trial_start: string | null; trial_end: string | null; joined_at: string },
  plan: ActiPlan,
  usage: { meetings: number; companies: number },
  todayIso: string
): TrialState {
  const { start, end } = trialWindow(member, plan);
  const daysLeft = Math.max(0, daysBetween(todayIso, end));
  let reason: TrialState["reason"] = null;
  if (usage.meetings >= plan.trialMeetings) reason = "meetings";
  else if (usage.companies >= plan.trialCompanies) reason = "companies";
  else if (todayIso > end) reason = "expired";
  return {
    start, end, daysLeft,
    meetingsUsed: usage.meetings, companiesUsed: usage.companies,
    meetingsLimit: plan.trialMeetings, companiesLimit: plan.trialCompanies,
    completed: reason !== null, reason,
  };
}

// Avance del mes contra la garantía (planes pagados)
export function monthProgress(plan: ActiPlan, done: number, scheduled: number) {
  const goal = plan.guaranteedMeetings;
  return {
    goal,
    done,
    scheduled,
    pct: goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0,
    missing: Math.max(0, goal - done),
  };
}

export const canSeePulsoView = (plan: ActiPlan, slug: string) => plan.pulsoViews.includes(slug);

// ── Qué incluye cada plan (vista "Mi plan") ──────────────────────────────

export type PlanFeature = { key: string; label: string; value: string; included: boolean };

const fmtUf = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace(".", ",")} UF`;

export function planPriceLabel(plan: ActiPlan): string {
  if (plan.baseUf === 0 && plan.perMeetingUf === 0) return "Incluido en tu membresía ACTI";
  return `${fmtUf(plan.baseUf)} al mes + ${fmtUf(plan.perMeetingUf)} por reunión`;
}

export function planFeatures(plan: ActiPlan, params: ActiParams): PlanFeature[] {
  const trial = isTrialPlan(plan);
  const views = PULSO_VIEW_OPTIONS.filter((v) => plan.pulsoViews.includes(v.slug)).map((v) => v.label);
  const pulsoViews = views.filter((v) => v !== "Peitho");
  const charge = params.chargeVariableOn === "realizada" ? "realizada" : "agendada";
  return [
    {
      key: "meetings",
      label: "Reuniones",
      value: trial ? `Hasta ${plan.trialMeetings} en ${plan.trialDays} días` : `${plan.guaranteedMeetings} garantizadas al mes`,
      included: true,
    },
    {
      key: "companies",
      label: "Empresas trabajadas",
      value: trial
        ? `Hasta ${plan.trialCompanies} (lo que ocurra primero)`
        : `Las necesarias para cumplir (~${monthlyCompanyQuota(plan, params)} al mes)`,
      included: true,
    },
    {
      key: "kam",
      label: "KAM dedicado",
      value: plan.hasKam ? "Sí, un KAM de BullsEye para tu cuenta" : trial ? "Onboarding grupal y soporte en la plataforma" : "Soporte del equipo BullsEye en la plataforma",
      included: plan.hasKam,
    },
    {
      key: "replace",
      label: "Reemplazo de cuentas sin respuesta",
      value: plan.replacesNoResponse
        ? `Sí (tras ${params.noResponseAttempts} intentos en ${params.noResponseBusinessDays} días hábiles)`
        : "No",
      included: plan.replacesNoResponse,
    },
    {
      key: "priority",
      label: "Prioridad en la prospección",
      value: trial ? "Estándar" : plan.priority >= 3 ? "Máxima" : plan.priority >= 2 ? "Alta" : "Prioritaria sobre Freemium",
      included: !trial,
    },
    { key: "ai", label: "Recomendaciones de empresas con IA", value: "Según tu ICP", included: true },
    {
      key: "peitho",
      label: "Peitho: análisis de cada reunión",
      value: plan.pulsoViews.includes("peitho") ? "Sí" : "No",
      included: plan.pulsoViews.includes("peitho"),
    },
    {
      key: "pulso",
      label: "Pulso ABM",
      value: pulsoViews.length === 0 ? "No" : plan.pulsoShowContacts ? "Completo, como un cliente directo de BullsEye" : pulsoViews.join(", "),
      included: pulsoViews.length > 0,
    },
    { key: "events", label: "Eventos y ronda de negocios ACTI", value: "Sí (no consumen el cupo del plan)", included: true },
    {
      key: "billing",
      label: "Cobro variable",
      value: plan.perMeetingUf > 0 ? `Por reunión ${charge}; si el prospecto no asiste, no se cobra` : "Sin costo",
      included: true,
    },
  ];
}
