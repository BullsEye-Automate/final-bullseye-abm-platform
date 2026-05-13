// Queries de agregación para el dashboard. Sprint 5 fase 1.
//
// Cada métrica se calcula para el rango actual + el rango "anterior" de
// igual longitud, así la UI muestra delta % (↑/↓).
//
// Diseñado para volumen chico-medio (cientos a miles de filas en el
// período). Si la app crece a decenas de miles, conviene migrar a
// materialized views o pre-agregar en backround. Por ahora SELECT
// directo con count="exact" head=true para counts; fetch + agrupar en
// JS para distribuciones y time series.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateRange } from "./dashboardRanges";

export type Delta = {
  current: number;
  previous: number;
  /** Cambio porcentual; null si previous=0 (división por cero). */
  pct_change: number | null;
};

export type DashboardData = {
  range: {
    key: string;
    label: string;
    start: string; // ISO
    end: string;
    previous: { start: string; end: string };
  };
  pipeline: {
    companies_discovered: Delta;
    companies_approved: Delta;
    companies_rejected: Delta;
    contacts_imported: Delta;
    contacts_yes: Delta;
    contacts_in_lemlist: Delta;
    contacts_with_phone: Delta;
    contacts_in_hubspot: Delta;
    /** % aprobadas / descubiertas */
    approval_rate: number | null;
    /** % YES / total pre-filtered */
    fit_rate: number | null;
    /** % con phone / en Lemlist */
    phone_rate: number | null;
    /** % en HubSpot / aprobados manualmente */
    hubspot_rate: number | null;
  };
  funnel: Array<{
    step: string;
    count: number;
    rate_from_prev: number | null;
    rate_from_top: number | null;
  }>;
  distribution: {
    company_types: Array<{ key: string; label: string; count: number }>;
    phone_sources: Array<{ key: string; label: string; count: number }>;
    fit_actions: Array<{ key: string; label: string; count: number }>;
  };
  quality: {
    manual_review_pending: number;
    human_agreement_rate: number | null;
    discard_reasons: Array<{ reason: string; count: number }>;
  };
  activity: Array<{
    date: string; // YYYY-MM-DD
    companies_approved: number;
    contacts_imported: number;
  }>;
};

function mkDelta(current: number, previous: number): Delta {
  const pct =
    previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / previous) * 100;
  return { current, previous, pct_change: pct };
}

function safePct(num: number, den: number): number | null {
  if (den === 0) return null;
  return (num / den) * 100;
}

async function countCompanies(
  db: SupabaseClient,
  start: Date,
  end: Date,
  extraFilter?: (q: any) => any
): Promise<number> {
  let q = db
    .from("companies")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (extraFilter) q = extraFilter(q);
  const { count } = await q;
  return count ?? 0;
}

async function countContacts(
  db: SupabaseClient,
  start: Date,
  end: Date,
  extraFilter?: (q: any) => any
): Promise<number> {
  let q = db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (extraFilter) q = extraFilter(q);
  const { count } = await q;
  return count ?? 0;
}

export async function computeDashboard(
  db: SupabaseClient,
  range: DateRange,
  rangeKey: string
): Promise<DashboardData> {
  const { start, end, previous } = range;

  // ---- Pipeline counts (en paralelo) ----
  const [
    cDiscovered,
    cApproved,
    cRejected,
    contactsImported,
    contactsYes,
    contactsInLemlist,
    contactsWithPhone,
    contactsInHubspot,
    pcDiscovered,
    pcApproved,
    pcRejected,
    pcontactsImported,
    pcontactsYes,
    pcontactsInLemlist,
    pcontactsWithPhone,
    pcontactsInHubspot
  ] = await Promise.all([
    // current
    countCompanies(db, start, end),
    countCompanies(db, start, end, (q) => q.eq("status", "approved")),
    countCompanies(db, start, end, (q) => q.eq("status", "rejected")),
    countContacts(db, start, end),
    countContacts(db, start, end, (q) => q.eq("prefilter_result", "yes")),
    countContacts(db, start, end, (q) => q.not("lemlist_pushed_at", "is", null)),
    countContacts(db, start, end, (q) => q.not("phone", "is", null).neq("phone", "")),
    countContacts(db, start, end, (q) => q.not("hubspot_contact_id", "is", null)),
    // previous
    countCompanies(db, previous.start, previous.end),
    countCompanies(db, previous.start, previous.end, (q) => q.eq("status", "approved")),
    countCompanies(db, previous.start, previous.end, (q) => q.eq("status", "rejected")),
    countContacts(db, previous.start, previous.end),
    countContacts(db, previous.start, previous.end, (q) => q.eq("prefilter_result", "yes")),
    countContacts(db, previous.start, previous.end, (q) => q.not("lemlist_pushed_at", "is", null)),
    countContacts(db, previous.start, previous.end, (q) =>
      q.not("phone", "is", null).neq("phone", "")
    ),
    countContacts(db, previous.start, previous.end, (q) => q.not("hubspot_contact_id", "is", null))
  ]);

  // ---- Distribuciones ----
  const [companiesRows, contactsRows] = await Promise.all([
    db
      .from("companies")
      .select("company_type, status")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString()),
    db
      .from("contacts")
      .select(
        "prefilter_result, fit_action, phone, phone_source, lemlist_pushed_at, hubspot_contact_id, human_decision, human_decision_reason, prefilter_reason, created_at"
      )
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
  ]);

  const companyTypeCounts: Record<string, number> = {};
  for (const r of companiesRows.data ?? []) {
    const t = (r as { company_type: string | null }).company_type ?? "unknown";
    companyTypeCounts[t] = (companyTypeCounts[t] ?? 0) + 1;
  }
  const COMPANY_TYPE_LABEL: Record<string, string> = {
    lab: "Laboratorio dental",
    multi_clinic: "Clínica multi-locación",
    dso: "DSO",
    other: "Otro",
    unknown: "Sin clasificar"
  };
  const company_types = Object.entries(companyTypeCounts)
    .map(([key, count]) => ({ key, label: COMPANY_TYPE_LABEL[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);

  // Solo contamos origen de phone sobre los contactos que entraron a
  // Lemlist (outreach activo). Sin este filtro, "Sin teléfono" infla
  // con contactos que pre-filter NO o que están en cola — no es
  // accionable.
  const phoneSourceCounts: Record<string, number> = { lemlist: 0, lusha: 0, none: 0 };
  for (const r of contactsRows.data ?? []) {
    const c = r as {
      phone: string | null;
      phone_source: string | null;
      lemlist_pushed_at: string | null;
    };
    if (!c.lemlist_pushed_at) continue;
    if (!c.phone || c.phone.trim().length < 4) {
      phoneSourceCounts.none++;
    } else if (c.phone_source === "lusha") {
      phoneSourceCounts.lusha++;
    } else {
      phoneSourceCounts.lemlist++;
    }
  }
  const PHONE_SOURCE_LABEL: Record<string, string> = {
    lemlist: "Lemlist",
    lusha: "Lusha",
    none: "Sin teléfono"
  };
  const phone_sources = Object.entries(phoneSourceCounts).map(([key, count]) => ({
    key,
    label: PHONE_SOURCE_LABEL[key] ?? key,
    count
  }));

  const fitActionCounts: Record<string, number> = {};
  for (const r of contactsRows.data ?? []) {
    const a = (r as { fit_action: string | null }).fit_action ?? "pending";
    fitActionCounts[a] = (fitActionCounts[a] ?? 0) + 1;
  }
  const FIT_ACTION_LABEL: Record<string, string> = {
    enrich: "Auto-aprobado (enrich)",
    manual_review: "Revisión manual",
    discard: "Descartado",
    pending: "Pendiente scoring"
  };
  const fit_actions = Object.entries(fitActionCounts)
    .map(([key, count]) => ({ key, label: FIT_ACTION_LABEL[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);

  // ---- Quality ----
  const manualReviewPending = (contactsRows.data ?? []).filter((r) => {
    const c = r as { fit_action: string | null; human_decision: string | null };
    return c.fit_action === "manual_review" && !c.human_decision;
  }).length;

  // Acuerdo IA vs humano: tomar contactos manual_review con human_decision
  // y comparar contra qué dijo Claude (action).
  const manualReviewDecided = (contactsRows.data ?? []).filter((r) => {
    const c = r as { fit_action: string | null; human_decision: string | null };
    return c.fit_action === "manual_review" && c.human_decision;
  });
  const humanAgreement =
    manualReviewDecided.length === 0
      ? null
      : (manualReviewDecided.filter((r) => {
          const c = r as { human_decision: string | null };
          // Si IA dijo manual_review (no era ni claro YES ni claro NO),
          // y el humano aprobó, contamos como "humano sobrescribió a aprobar".
          // El proxy de "acuerdo" más útil: discard_rate ≈ rejection_rate.
          // Acá calculamos % donde human_decision = rejected (humano alineado
          // con la duda de Claude).
          return c.human_decision === "rejected";
        }).length /
          manualReviewDecided.length) *
        100;

  const discardReasonCounts: Record<string, number> = {};
  for (const r of contactsRows.data ?? []) {
    const c = r as { fit_action: string | null; prefilter_reason: string | null };
    if (c.fit_action === "discard" && c.prefilter_reason) {
      // Quedarnos con la primera frase (resumir).
      const short = c.prefilter_reason.split(/[.;]/)[0].slice(0, 60).trim();
      if (short) discardReasonCounts[short] = (discardReasonCounts[short] ?? 0) + 1;
    }
  }
  const discard_reasons = Object.entries(discardReasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ---- Time series por día ----
  // Buckets: companies aprobadas (approved_at o created_at) + contactos
  // importados (created_at). Generamos un slot por día del rango.
  const days = enumerateDays(start, end);
  const companiesApprovedByDay: Record<string, number> = {};
  const contactsImportedByDay: Record<string, number> = {};
  // Fetch companies con approved_at en el rango (para "aprobadas el día X").
  const { data: approvedRows } = await db
    .from("companies")
    .select("approved_at")
    .gte("approved_at", start.toISOString())
    .lte("approved_at", end.toISOString())
    .not("approved_at", "is", null);
  for (const r of approvedRows ?? []) {
    const d = (r as { approved_at: string }).approved_at.slice(0, 10);
    companiesApprovedByDay[d] = (companiesApprovedByDay[d] ?? 0) + 1;
  }
  for (const r of contactsRows.data ?? []) {
    const d = (r as { created_at: string }).created_at.slice(0, 10);
    contactsImportedByDay[d] = (contactsImportedByDay[d] ?? 0) + 1;
  }
  const activity = days.map((d) => ({
    date: d,
    companies_approved: companiesApprovedByDay[d] ?? 0,
    contacts_imported: contactsImportedByDay[d] ?? 0
  }));

  // ---- Funnel ----
  const funnelTop = cDiscovered;
  const funnel = [
    { step: "Empresas descubiertas", count: cDiscovered },
    { step: "Empresas aprobadas", count: cApproved },
    { step: "Contactos importados", count: contactsImported },
    { step: "Pre-filter YES", count: contactsYes },
    { step: "En Lemlist", count: contactsInLemlist },
    { step: "Con teléfono", count: contactsWithPhone },
    { step: "En HubSpot", count: contactsInHubspot }
  ].map((f, i, arr) => ({
    ...f,
    rate_from_prev: i === 0 ? null : safePct(f.count, arr[i - 1].count),
    rate_from_top: i === 0 ? null : safePct(f.count, funnelTop)
  }));

  return {
    range: {
      key: rangeKey,
      label: range.label,
      start: start.toISOString(),
      end: end.toISOString(),
      previous: {
        start: previous.start.toISOString(),
        end: previous.end.toISOString()
      }
    },
    pipeline: {
      companies_discovered: mkDelta(cDiscovered, pcDiscovered),
      companies_approved: mkDelta(cApproved, pcApproved),
      companies_rejected: mkDelta(cRejected, pcRejected),
      contacts_imported: mkDelta(contactsImported, pcontactsImported),
      contacts_yes: mkDelta(contactsYes, pcontactsYes),
      contacts_in_lemlist: mkDelta(contactsInLemlist, pcontactsInLemlist),
      contacts_with_phone: mkDelta(contactsWithPhone, pcontactsWithPhone),
      contacts_in_hubspot: mkDelta(contactsInHubspot, pcontactsInHubspot),
      approval_rate: safePct(cApproved, cDiscovered),
      fit_rate: safePct(contactsYes, contactsImported),
      phone_rate: safePct(contactsWithPhone, contactsInLemlist),
      hubspot_rate: safePct(contactsInHubspot, contactsInLemlist)
    },
    funnel,
    distribution: { company_types, phone_sources, fit_actions },
    quality: {
      manual_review_pending: manualReviewPending,
      human_agreement_rate: humanAgreement,
      discard_reasons
    },
    activity
  };
}

function enumerateDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  // Cap: si el rango es > 180 días (año), bucket por mes en vez de día.
  if (days.length > 180) {
    const seen = new Set<string>();
    return days
      .map((d) => d.slice(0, 7) + "-01")
      .filter((d) => {
        if (seen.has(d)) return false;
        seen.add(d);
        return true;
      });
  }
  return days;
}
