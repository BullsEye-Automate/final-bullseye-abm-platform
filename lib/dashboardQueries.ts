import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateRange, RangeKey } from "./dashboardRanges";
import { RANGE_LABELS } from "./dashboardRanges";

export type Delta = { current: number; previous: number; pct_change: number | null };

export type DashboardData = {
  range: {
    key: string; label: string; start: string; end: string;
    previous: { start: string; end: string };
  };
  pipeline: {
    companies_discovered: Delta; companies_approved: Delta; companies_rejected: Delta;
    contacts_imported: Delta; contacts_yes: Delta; contacts_in_lemlist: Delta;
    contacts_with_phone: Delta; contacts_in_hubspot: Delta;
    approval_rate: number | null; fit_rate: number | null;
    phone_rate: number | null; hubspot_rate: number | null;
  };
  funnel: Array<{ step: string; count: number; rate_from_prev: number | null; rate_from_top: number | null }>;
  distribution: {
    company_types: Array<{ key: string; label: string; count: number }>;
    fit_actions: Array<{ key: string; label: string; count: number }>;
  };
  quality: {
    human_agreement_rate: number | null;
    discard_reasons: Array<{ reason: string; count: number }>;
  };
  usage: {
    total_companies_worked: number; clay_companies: number; clay_contacts: number;
    sales_nav_companies: number; sales_nav_contacts: number;
    avg_contacts_per_company: number | null;
  };
  evolution_8mo: Array<{ month: string; label: string; companies_clay_push: number; contacts_total: number }>;
  clay_funnel: { total_from_clay: number; fit: number; in_lemlist: number };
  coverage: { total_in_clay: number; no_contacts: number; one_contact: number; two_plus_contacts: number };
  activity: Array<{ date: string; companies_approved: number; contacts_imported: number }>;
};

function mkDelta(current: number, previous: number): Delta {
  const pct =
    previous === 0
      ? current === 0 ? 0 : null
      : ((current - previous) / previous) * 100;
  return { current, previous, pct_change: pct };
}

function safePct(num: number, den: number): number | null {
  if (den === 0) return null;
  return (num / den) * 100;
}

async function countTable(
  db: SupabaseClient,
  table: "companies" | "contacts",
  start: Date,
  end: Date,
  extra?: (q: any) => any,
  clientId?: string | null
): Promise<number> {
  let q = db
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (clientId) q = q.eq("client_id", clientId);
  if (extra) q = extra(q);
  const { count } = await q;
  return count ?? 0;
}

const COMPANY_TYPE_LABELS: Record<string, string> = {
  lab: "Laboratorio dental",
  multi_clinic: "Multi-clínica",
  dso: "DSO",
  other: "Otro"
};

const FIT_ACTION_LABELS: Record<string, string> = {
  enrich: "Fit (Enrich)",
  discard: "Descartado",
  manual_review: "Revisión manual"
};

export async function computeDashboard(
  db: SupabaseClient,
  range: DateRange,
  rangeKey: RangeKey,
  clientId?: string | null
): Promise<DashboardData> {
  const { start, end, previous } = range;
  const cid = clientId ?? null;

  // ── Pipeline counts (paralelo) ─────────────────────────────────────
  const [
    cDisc, cAppr, cRej,
    ctImp, ctYes, ctLem, ctPhone, ctHub,
    pDisc, pAppr, pRej,
    pctImp, pctYes, pctLem, pctPhone, pctHub
  ] = await Promise.all([
    countTable(db, "companies", start, end, undefined, cid),
    countTable(db, "companies", start, end, q => q.eq("status", "approved"), cid),
    countTable(db, "companies", start, end, q => q.eq("status", "rejected"), cid),
    countTable(db, "contacts",  start, end, undefined, cid),
    countTable(db, "contacts",  start, end, q => q.eq("prefilter_result", "yes"), cid),
    countTable(db, "contacts",  start, end, q => q.not("lemlist_pushed_at", "is", null), cid),
    countTable(db, "contacts",  start, end, q => q.not("phone", "is", null).not("lemlist_pushed_at", "is", null), cid),
    countTable(db, "contacts",  start, end, q => q.not("hubspot_contact_id", "is", null), cid),
    // Previous period
    countTable(db, "companies", previous.start, previous.end, undefined, cid),
    countTable(db, "companies", previous.start, previous.end, q => q.eq("status", "approved"), cid),
    countTable(db, "companies", previous.start, previous.end, q => q.eq("status", "rejected"), cid),
    countTable(db, "contacts",  previous.start, previous.end, undefined, cid),
    countTable(db, "contacts",  previous.start, previous.end, q => q.eq("prefilter_result", "yes"), cid),
    countTable(db, "contacts",  previous.start, previous.end, q => q.not("lemlist_pushed_at", "is", null), cid),
    countTable(db, "contacts",  previous.start, previous.end, q => q.not("phone", "is", null).not("lemlist_pushed_at", "is", null), cid),
    countTable(db, "contacts",  previous.start, previous.end, q => q.not("hubspot_contact_id", "is", null), cid),
  ]);

  // ── Funnel ────────────────────────────────────────────────────────
  const funnelSteps = [
    { step: "Descubiertas", count: cDisc },
    { step: "Aprobadas",    count: cAppr },
    { step: "Contactos",    count: ctImp  },
    { step: "YES",          count: ctYes  },
    { step: "Lemlist",      count: ctLem  },
    { step: "Teléfono",     count: ctPhone },
    { step: "HubSpot",      count: ctHub  }
  ];
  const funnel = funnelSteps.map((s, i) => ({
    ...s,
    rate_from_prev: i === 0 ? null : safePct(s.count, funnelSteps[i - 1].count),
    rate_from_top:  i === 0 ? null : safePct(s.count, funnelSteps[0].count)
  }));

  // ── Distributions ─────────────────────────────────────────────────
  let tq = db.from("companies").select("company_type")
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
    .not("company_type", "is", null);
  if (cid) tq = tq.eq("client_id", cid);
  const { data: typeRows } = await tq;
  const typeCounts = new Map<string, number>();
  for (const r of typeRows ?? []) {
    const k = r.company_type ?? "other";
    typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
  }
  const company_types = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: COMPANY_TYPE_LABELS[key] ?? key, count }));

  let aq = db.from("contacts").select("fit_action")
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
    .not("fit_action", "is", null);
  if (cid) aq = aq.eq("client_id", cid);
  const { data: actionRows } = await aq;
  const actionCounts = new Map<string, number>();
  for (const r of actionRows ?? []) {
    const k = r.fit_action ?? "other";
    actionCounts.set(k, (actionCounts.get(k) ?? 0) + 1);
  }
  const fit_actions = Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: FIT_ACTION_LABELS[key] ?? key, count }));

  // ── Quality ───────────────────────────────────────────────────────
  let hq = db.from("contacts").select("human_decision")
    .eq("fit_action", "enrich")
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
    .not("human_decision", "is", null);
  if (cid) hq = hq.eq("client_id", cid);
  const { data: humanRows } = await hq;
  const humanApproved = (humanRows ?? []).filter(r => r.human_decision === "approved").length;
  const humanTotal = (humanRows ?? []).length;
  const human_agreement_rate = humanTotal === 0 ? null : (humanApproved / humanTotal) * 100;

  let fq = db.from("contact_feedback").select("human_reason")
    .eq("human_action", "rejected")
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
  const { data: feedbackRows } = await fq;
  const reasonCounts = new Map<string, number>();
  for (const r of feedbackRows ?? []) {
    const reason = (r.human_reason ?? "Sin razón").toLowerCase().trim().slice(0, 60);
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const discard_reasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // ── Usage (range-bound) ───────────────────────────────────────────
  let wcq = db.from("companies").select("id")
    .gte("clay_pushed_at", start.toISOString()).lte("clay_pushed_at", end.toISOString());
  if (cid) wcq = wcq.eq("client_id", cid);
  const { data: clayPushedCompanies } = await wcq;
  const clayPushedSet = new Set((clayPushedCompanies ?? []).map((c) => c.id));

  let srcq = db.from("contacts").select("company_id, source")
    .gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
  if (cid) srcq = srcq.eq("client_id", cid);
  const { data: contactsSrc } = await srcq;
  const claySet = new Set<string>(), navSet = new Set<string>();
  let clayContacts = 0, navContacts = 0;
  for (const r of contactsSrc ?? []) {
    const src = r.source ?? "clay";
    if (src === "clay") { clayContacts++; if (r.company_id) claySet.add(r.company_id); }
    else { navContacts++; if (r.company_id) navSet.add(r.company_id); }
  }
  const totalContacts = clayContacts + navContacts;
  const companiesWithContacts = new Set([...claySet, ...navSet]).size;
  // "Empresa trabajada" = pasó por Clay (clay_pushed_at en rango) O recibió
  // contactos por vía manual (source != 'clay', ej. búsqueda manual) en el
  // rango — así lo hecho en /busqueda-manual también cuenta en reportería.
  const totalWorked = new Set([...clayPushedSet, ...navSet]).size;

  // ── Evolution 8 months ───────────────────────────────────────────
  const now = new Date();
  const months = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (7 - i), 1));
    const mStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const mEnd   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return {
      start: mStart, end: mEnd,
      key: `${mStart.getUTCFullYear()}-${String(mStart.getUTCMonth() + 1).padStart(2, "0")}`,
      label: mStart.toLocaleDateString("es", { month: "short", year: "numeric", timeZone: "UTC" })
    };
  });
  const evolution_8mo = await Promise.all(months.map(async m => {
    let cq2 = db.from("companies").select("id", { count: "exact", head: true })
      .gte("clay_pushed_at", m.start.toISOString()).lte("clay_pushed_at", m.end.toISOString());
    if (cid) cq2 = cq2.eq("client_id", cid);
    let ctq2 = db.from("contacts").select("id", { count: "exact", head: true })
      .gte("created_at", m.start.toISOString()).lte("created_at", m.end.toISOString());
    if (cid) ctq2 = ctq2.eq("client_id", cid);
    const [cRes, ctRes] = await Promise.all([cq2, ctq2]);
    return { month: m.key, label: m.label, companies_clay_push: cRes.count ?? 0, contacts_total: ctRes.count ?? 0 };
  }));

  // ── Clay funnel ───────────────────────────────────────────────────
  const [clayCt, clayFit, clayLem] = await Promise.all([
    countTable(db, "contacts", start, end, q => q.eq("source", "clay"), cid),
    countTable(db, "contacts", start, end, q => q.eq("source", "clay").eq("fit_action", "enrich"), cid),
    countTable(db, "contacts", start, end, q => q.eq("source", "clay").not("lemlist_pushed_at", "is", null), cid),
  ]);

  // ── Coverage (global snapshot, NOT range-bound) ───────────────────
  let covCq = db.from("companies").select("id").not("clay_pushed_at", "is", null);
  if (cid) covCq = covCq.eq("client_id", cid);
  let covCtq = db.from("contacts").select("company_id");
  if (cid) covCtq = covCtq.eq("client_id", cid);
  const [{ data: covCompanies }, { data: covContacts }] = await Promise.all([covCq, covCtq]);
  const covMap = new Map<string, number>();
  for (const r of covContacts ?? []) {
    if (r.company_id) covMap.set(r.company_id, (covMap.get(r.company_id) ?? 0) + 1);
  }
  let noContacts = 0, oneContact = 0, twoPlus = 0;
  for (const c of covCompanies ?? []) {
    const n = covMap.get(c.id) ?? 0;
    if (n === 0) noContacts++;
    else if (n === 1) oneContact++;
    else twoPlus++;
  }

  // ── Activity (daily, only if range ≤ 60 days) ────────────────────
  let activity: DashboardData["activity"] = [];
  const diffDays = (end.getTime() - start.getTime()) / 86400000;
  if (diffDays <= 60) {
    const days: string[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
      days.push(d.toISOString().slice(0, 10));
    }
    activity = await Promise.all(days.map(async day => {
      const dayStart = new Date(day + "T00:00:00.000Z");
      const dayEnd   = new Date(day + "T23:59:59.999Z");
      const [ca, ci] = await Promise.all([
        countTable(db, "companies", dayStart, dayEnd, q => q.eq("status", "approved"), cid),
        countTable(db, "contacts",  dayStart, dayEnd, undefined, cid),
      ]);
      return { date: day, companies_approved: ca, contacts_imported: ci };
    }));
  }

  return {
    range: {
      key: rangeKey,
      label: RANGE_LABELS[rangeKey],
      start: start.toISOString(),
      end: end.toISOString(),
      previous: { start: previous.start.toISOString(), end: previous.end.toISOString() }
    },
    pipeline: {
      companies_discovered: mkDelta(cDisc, pDisc),
      companies_approved:   mkDelta(cAppr, pAppr),
      companies_rejected:   mkDelta(cRej,  pRej),
      contacts_imported:    mkDelta(ctImp, pctImp),
      contacts_yes:         mkDelta(ctYes, pctYes),
      contacts_in_lemlist:  mkDelta(ctLem, pctLem),
      contacts_with_phone:  mkDelta(ctPhone, pctPhone),
      contacts_in_hubspot:  mkDelta(ctHub, pctHub),
      approval_rate:  safePct(cAppr, cDisc),
      fit_rate:       safePct(ctYes, ctImp),
      phone_rate:     safePct(ctPhone, ctLem),
      hubspot_rate:   safePct(ctHub, cAppr),
    },
    funnel,
    distribution: { company_types, fit_actions },
    quality: { human_agreement_rate, discard_reasons },
    usage: {
      total_companies_worked: totalWorked,
      clay_companies: claySet.size,
      clay_contacts: clayContacts,
      sales_nav_companies: navSet.size,
      sales_nav_contacts: navContacts,
      avg_contacts_per_company: companiesWithContacts === 0 ? null : totalContacts / companiesWithContacts
    },
    evolution_8mo,
    clay_funnel: { total_from_clay: clayCt, fit: clayFit, in_lemlist: clayLem },
    coverage: { total_in_clay: covCompanies?.length ?? 0, no_contacts: noContacts, one_contact: oneContact, two_plus_contacts: twoPlus },
    activity
  };
}
