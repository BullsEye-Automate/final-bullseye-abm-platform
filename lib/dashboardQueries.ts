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
  // Métricas de uso del equipo (range-bound). Para medir gestión mensual.
  usage: {
    /** Empresas que entraron al sistema en el rango (clay_pushed_at en rango). */
    total_companies_worked: number;
    /** Empresas únicas con ≥1 contacto source='clay' creado en el rango. */
    clay_companies: number;
    /** Contactos source='clay' creados en el rango. */
    clay_contacts: number;
    /** Empresas únicas con ≥1 contacto source='sales_navigator' creado en el rango. */
    sales_nav_companies: number;
    /** Contactos source='sales_navigator' creados en el rango. */
    sales_nav_contacts: number;
    /** Promedio contactos por empresa (total contactos / empresas únicas con ≥1). */
    avg_contacts_per_company: number | null;
  };
  /** Evolución últimos 8 meses (no range-bound). Mes a mes. */
  evolution_8mo: Array<{
    /** YYYY-MM */
    month: string;
    /** "Abr 2026" o similar. */
    label: string;
    /** Empresas con clay_pushed_at en ese mes. */
    companies_clay_push: number;
    /** Contactos source='clay' creados en ese mes. */
    contacts_from_clay: number;
    /** Contactos source='sales_navigator' creados en ese mes. */
    contacts_from_sales_nav: number;
    /** Total contactos creados en ese mes (todas las fuentes). */
    contacts_total: number;
  }>;
  /** Uso estimado por proveedor (range-bound). */
  provider_usage: Array<{
    name: string;
    operations_label: string;
    operations: number;
    /** Estimación en USD. null si no se puede estimar. */
    estimated_cost_usd: number | null;
    note: string;
  }>;
  /** Embudo de contactos levantados por Clay (range-bound). */
  clay_funnel: {
    total_from_clay: number;
    fit: number;
    manual_review: number;
    manual_review_approved: number;
    in_lemlist: number;
  };
  // Cobertura del módulo Sales Navigator (estado actual, NO range-bound).
  // Empresas que pasaron por Clay agrupadas por cuántos contactos
  // encontramos. Permite ver de un vistazo cuánto trabajo manual queda
  // (sin contactos + con 1) vs cobertura sana (2+).
  coverage: {
    total_in_clay: number;
    no_contacts: number;
    one_contact: number;
    two_plus_contacts: number;
    no_fit_marked: number;
    // Empresas que el SDR trabajó manualmente en Sales Nav:
    // - marcadas como no_fit, O
    // - Clay no encontró nada (clay_no_contacts_at !== null) pero ahora
    //   tienen contactos = vinieron del flujo manual de Sales Nav.
    manually_worked: number;
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

  // ---- Usage range-bound (medición de gestión del equipo) ----
  const [usageCompaniesRes, usageContactsRes] = await Promise.all([
    db
      .from("companies")
      .select("id, clay_pushed_at")
      .gte("clay_pushed_at", start.toISOString())
      .lt("clay_pushed_at", end.toISOString())
      .limit(20000),
    db
      .from("contacts")
      .select("id, company_id, source, created_at")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .limit(50000)
  ]);
  const usageCompanies = (usageCompaniesRes.data ?? []) as Array<{ id: string }>;
  const usageContacts = (usageContactsRes.data ?? []) as Array<{
    company_id: string | null;
    source: string | null;
  }>;
  const clayCompanySet = new Set<string>();
  const snCompanySet = new Set<string>();
  const anyCompanySet = new Set<string>();
  let clayContactsCount = 0;
  let snContactsCount = 0;
  for (const c of usageContacts) {
    if (c.company_id) anyCompanySet.add(c.company_id);
    if (c.source === "clay") {
      clayContactsCount++;
      if (c.company_id) clayCompanySet.add(c.company_id);
    } else if (c.source === "sales_navigator") {
      snContactsCount++;
      if (c.company_id) snCompanySet.add(c.company_id);
    }
  }
  const avgContacts =
    anyCompanySet.size > 0 ? usageContacts.length / anyCompanySet.size : null;

  // ---- Evolution últimos 8 meses (no range-bound) ----
  // Generamos los 8 meses (incluyendo el actual) en orden cronológico ascendente.
  const monthBuckets: Array<{ key: string; label: string; start: Date; end: Date }> = [];
  const nowMonthRef = new Date();
  nowMonthRef.setUTCDate(1);
  nowMonthRef.setUTCHours(0, 0, 0, 0);
  for (let i = 7; i >= 0; i--) {
    const s = new Date(nowMonthRef);
    s.setUTCMonth(s.getUTCMonth() - i);
    const e = new Date(s);
    e.setUTCMonth(e.getUTCMonth() + 1);
    const key = `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthName = s.toLocaleString("es", { month: "short", timeZone: "UTC" });
    const label = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1).replace(".", "")} ${s.getUTCFullYear()}`;
    monthBuckets.push({ key, label, start: s, end: e });
  }
  const evoStart = monthBuckets[0].start;
  const evoEnd = monthBuckets[monthBuckets.length - 1].end;

  const [evoCompaniesRes, evoContactsRes] = await Promise.all([
    db
      .from("companies")
      .select("clay_pushed_at")
      .gte("clay_pushed_at", evoStart.toISOString())
      .lt("clay_pushed_at", evoEnd.toISOString())
      .limit(50000),
    db
      .from("contacts")
      .select("source, created_at")
      .gte("created_at", evoStart.toISOString())
      .lt("created_at", evoEnd.toISOString())
      .limit(100000)
  ]);

  function monthKeyOf(iso: string): string {
    return iso.slice(0, 7);
  }
  const pushByMonth = new Map<string, number>();
  for (const r of (evoCompaniesRes.data ?? []) as Array<{ clay_pushed_at: string }>) {
    const k = monthKeyOf(r.clay_pushed_at);
    pushByMonth.set(k, (pushByMonth.get(k) ?? 0) + 1);
  }
  const clayContactsByMonth = new Map<string, number>();
  const snContactsByMonth = new Map<string, number>();
  const totalContactsByMonth = new Map<string, number>();
  for (const r of (evoContactsRes.data ?? []) as Array<{
    source: string | null;
    created_at: string;
  }>) {
    const k = monthKeyOf(r.created_at);
    totalContactsByMonth.set(k, (totalContactsByMonth.get(k) ?? 0) + 1);
    if (r.source === "clay") clayContactsByMonth.set(k, (clayContactsByMonth.get(k) ?? 0) + 1);
    else if (r.source === "sales_navigator")
      snContactsByMonth.set(k, (snContactsByMonth.get(k) ?? 0) + 1);
  }
  const evolution_8mo = monthBuckets.map((m) => ({
    month: m.key,
    label: m.label,
    companies_clay_push: pushByMonth.get(m.key) ?? 0,
    contacts_from_clay: clayContactsByMonth.get(m.key) ?? 0,
    contacts_from_sales_nav: snContactsByMonth.get(m.key) ?? 0,
    contacts_total: totalContactsByMonth.get(m.key) ?? 0
  }));

  // ---- Embudo Clay (range-bound) ----
  // Contactos cuyo source='clay' creados en el rango, agrupados por su
  // estado del pipeline:
  //   - levantados por Clay (total)
  //   - fit auto (fit_action='enrich' decidido por Clay AI)
  //   - manual_review (Clay AI lo dejó para revisión humana)
  //   - manual_review aprobados por el humano
  //   - en Lemlist (lemlist_pushed_at no null, por cualquier camino)
  const { data: clayFunnelRows } = await db
    .from("contacts")
    .select("fit_action, human_decision, lemlist_pushed_at")
    .eq("source", "clay")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .limit(50000);
  let cf_total = 0;
  let cf_fit = 0;
  let cf_mr = 0;
  let cf_mr_approved = 0;
  let cf_lemlist = 0;
  for (const r of (clayFunnelRows ?? []) as Array<{
    fit_action: string | null;
    human_decision: string | null;
    lemlist_pushed_at: string | null;
  }>) {
    cf_total++;
    if (r.fit_action === "enrich") cf_fit++;
    if (r.fit_action === "manual_review") {
      cf_mr++;
      if (r.human_decision === "approved") cf_mr_approved++;
    }
    if (r.lemlist_pushed_at) cf_lemlist++;
  }

  // ---- Uso estimado por proveedor (range-bound) ----
  // Estimaciones basadas en counters de operaciones × costo aproximado por
  // operación. NO son números de billing reales (cada proveedor tiene su
  // dashboard); sirven para tener una orden de magnitud y detectar picos.
  //
  // Costos por operación (USD, aproximaciones a 2026-05):
  //   Anthropic (Sonnet 4.6): pre-filter ~$0.002, message gen ~$0.005,
  //     research/analysis ~$0.02. Promedio ponderado ~$0.008/op.
  //   Perplexity (sonar-pro): ~$0.005 por search.
  //   Clay: ~5 créditos por empresa (Find People + Enrich Person).
  //     Plan típico ~$0.04/crédito → ~$0.20 por empresa.
  //   Lemlist: ~$0.50 por lead añadido (varía según plan).
  //   Lusha: ~$0.40 por teléfono encontrado (plan típico).
  //   HubSpot: API gratis dentro del rate limit; reportamos solo el conteo.

  const [
    contactsCreatedRes,
    callsAnalyzedRes,
    companiesPushedClayRes,
    contactsLemlistRes,
    contactsLushaRes,
    hubspotPushesRes
  ] = await Promise.all([
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    db
      .from("calls")
      .select("id", { count: "exact", head: true })
      .not("analyzed_at", "is", null)
      .gte("analyzed_at", start.toISOString())
      .lt("analyzed_at", end.toISOString()),
    db
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("clay_pushed_at", start.toISOString())
      .lt("clay_pushed_at", end.toISOString()),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .gte("lemlist_pushed_at", start.toISOString())
      .lt("lemlist_pushed_at", end.toISOString()),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("phone_source", "lusha")
      .gte("updated_at", start.toISOString())
      .lt("updated_at", end.toISOString()),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .gte("hubspot_synced_at", start.toISOString())
      .lt("hubspot_synced_at", end.toISOString())
  ]);

  const numContacts = contactsCreatedRes.count ?? 0;
  const numCallsAnalyzed = callsAnalyzedRes.count ?? 0;
  const numCompaniesPushed = companiesPushedClayRes.count ?? 0;
  const numLemlist = contactsLemlistRes.count ?? 0;
  const numLusha = contactsLushaRes.count ?? 0;
  const numHubspot = hubspotPushesRes.count ?? 0;

  // Anthropic: pre-filter por contacto (~$0.002) + message gen por contacto en
  // Lemlist (~$0.005) + research/análisis por empresa+call (~$0.02 c/u).
  // (Sumamos también discovery: pero discovery es 1 batch por corrida → no
  // tenemos un counter limpio. Aproximación: cDiscovered ~ 1 call per 10 empresas.)
  const anthropicEstimate =
    numContacts * 0.002 +
    numLemlist * 0.005 +
    cDiscovered * 0.025 +
    numCallsAnalyzed * 0.02;

  // Perplexity: discovery (1 search principal + 1 size salvage + 1 linkedin
  // salvage por corrida) + research one-shot (2 searches por empresa).
  // Estimación cruda: 2 searches por empresa descubierta.
  const perplexityEstimate = cDiscovered * 2 * 0.005;

  const provider_usage = [
    {
      name: "Anthropic (Claude)",
      operations_label:
        "pre-filtros + mensajes + análisis de llamadas + research",
      operations:
        numContacts + numLemlist + cDiscovered + numCallsAnalyzed,
      estimated_cost_usd: anthropicEstimate,
      note: "Estimación a partir de operaciones contadas. Verificar en console.anthropic.com."
    },
    {
      name: "Perplexity",
      operations_label: "searches durante discovery + research one-shot",
      operations: cDiscovered * 2,
      estimated_cost_usd: perplexityEstimate,
      note: "Cap aproximado de 2 searches por empresa descubierta."
    },
    {
      name: "Clay",
      operations_label: "empresas pushed (Find People + Enrich Person)",
      operations: numCompaniesPushed,
      estimated_cost_usd: numCompaniesPushed * 0.2,
      note: "≈5 créditos por empresa. Verificar consumo real en clay.com."
    },
    {
      name: "Lemlist",
      operations_label: "leads añadidos a la campaña",
      operations: numLemlist,
      estimated_cost_usd: numLemlist * 0.5,
      note: "1 lead = 1 crédito (varía según plan). Verificar en lemlist.com."
    },
    {
      name: "Lusha",
      operations_label: "teléfonos enriquecidos",
      operations: numLusha,
      estimated_cost_usd: numLusha * 0.4,
      note: "1 teléfono = 1 crédito Lusha. Verificar en lusha.com."
    },
    {
      name: "HubSpot",
      operations_label: "syncs de contacto (push o update)",
      operations: numHubspot,
      estimated_cost_usd: null,
      note: "API gratis dentro del rate limit (100 req/10s, 250k/día)."
    }
  ];

  // ---- Cobertura Sales Navigator (estado actual, no range-bound) ----
  // Empresas que pasaron por Clay agrupadas por cuántos contactos tenemos.
  const [coverageCompaniesRes, coverageContactsRes] = await Promise.all([
    db
      .from("companies")
      .select("id, sales_nav_status, clay_no_contacts_at")
      .not("clay_pushed_at", "is", null)
      .limit(10000),
    db.from("contacts").select("company_id").limit(50000)
  ]);
  const coverageCompanies = (coverageCompaniesRes.data ?? []) as Array<{
    id: string;
    sales_nav_status: string | null;
    clay_no_contacts_at: string | null;
  }>;
  const contactCountMap = new Map<string, number>();
  for (const r of (coverageContactsRes.data ?? []) as Array<{ company_id: string | null }>) {
    if (!r.company_id) continue;
    contactCountMap.set(r.company_id, (contactCountMap.get(r.company_id) ?? 0) + 1);
  }
  let cov_no_contacts = 0;
  let cov_one = 0;
  let cov_two_plus = 0;
  let cov_no_fit = 0;
  let cov_manually_worked = 0;
  for (const co of coverageCompanies) {
    if (co.sales_nav_status === "no_fit") {
      cov_no_fit++;
      cov_manually_worked++;
      continue;
    }
    const n = contactCountMap.get(co.id) ?? 0;
    if (n === 0) cov_no_contacts++;
    else if (n === 1) cov_one++;
    else cov_two_plus++;
    // Clay no encontró nada pero ahora hay contactos = SDR los agregó manualmente.
    if (co.clay_no_contacts_at && n > 0) cov_manually_worked++;
  }

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
    coverage: {
      total_in_clay: coverageCompanies.length,
      no_contacts: cov_no_contacts,
      one_contact: cov_one,
      two_plus_contacts: cov_two_plus,
      no_fit_marked: cov_no_fit,
      manually_worked: cov_manually_worked
    },
    usage: {
      total_companies_worked: usageCompanies.length,
      clay_companies: clayCompanySet.size,
      clay_contacts: clayContactsCount,
      sales_nav_companies: snCompanySet.size,
      sales_nav_contacts: snContactsCount,
      avg_contacts_per_company: avgContacts
    },
    evolution_8mo,
    provider_usage,
    clay_funnel: {
      total_from_clay: cf_total,
      fit: cf_fit,
      manual_review: cf_mr,
      manual_review_approved: cf_mr_approved,
      in_lemlist: cf_lemlist
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
