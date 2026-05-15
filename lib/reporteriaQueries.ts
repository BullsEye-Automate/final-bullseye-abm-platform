// Reportería ejecutiva — snapshot consolidado para mostrarle al cliente.
//
// A diferencia de /dashboard que es operacional (granular, técnico), este
// snapshot está pensado para una vista de agencia: hero KPIs con delta,
// embudo ejecutivo, outreach + respuestas + llamadas, hot leads, evolución.
// Reutiliza /api/dashboard internamente y suma las métricas que no están
// ahí (calls y respuestas).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateRange } from "./dashboardRanges";
import { computeDashboard, type Delta, type DashboardData } from "./dashboardQueries";
import { PICKUP_CATEGORIES, NO_PICKUP_CATEGORIES } from "./callAnalyzer";

const PICKUP_ARR = Array.from(PICKUP_CATEGORIES);
const NO_PICKUP_ARR = Array.from(NO_PICKUP_CATEGORIES);

export type ReporteriaSnapshot = {
  range: DashboardData["range"];

  hero: {
    companies_worked: Delta;
    contacts_generated: Delta;
    in_outreach: Delta;
    conversations: Delta;
    hot_leads: Delta;
  };

  executive_funnel: Array<{
    step: string;
    count: number;
    rate_from_prev: number | null;
  }>;

  outreach: {
    leads_in_lemlist: number;
    calls_made: number;
    calls_connected: number;
    avg_duration_sec: number | null;
    avg_sdr_score: number | null;
    pickup_rate_pct: number | null;
  };

  responses: {
    total: number;
    by_category: Array<{ category: string; label: string; count: number }>;
    positive_count: number;
    negative_count: number;
    neutral_count: number;
  };

  hot_leads: Array<{
    contact_id: string;
    contact_name: string;
    company_name: string | null;
    job_title: string | null;
    signals: string[];
    score: number;
    linkedin_url: string | null;
    hubspot_contact_id: string | null;
  }>;

  highlight: string;

  // Reuso del dashboard.
  evolution_8mo: DashboardData["evolution_8mo"];
};

const RESPONSE_LABELS: Record<string, string> = {
  interested: "Interesado",
  objection_price: "Objeción · precio",
  objection_timing: "Objeción · timing",
  objection_no_need: "Objeción · no necesita",
  objection_existing_solution: "Objeción · solución actual",
  objection_authority: "Objeción · autoridad",
  callback_requested: "Pide callback",
  not_interested: "No interesado",
  no_engagement: "Sin engagement",
  voicemail: "Voicemail",
  wrong_number: "Número equivocado",
  gatekeeper: "Gatekeeper",
  other: "Otro",
  positive: "Positiva",
  negative: "Negativa",
  question: "Pregunta",
  unsubscribe: "Unsubscribe"
};

const POSITIVE_REPLY_CATEGORIES = new Set(["interested", "positive", "question"]);
const NEGATIVE_REPLY_CATEGORIES = new Set([
  "not_interested",
  "negative",
  "unsubscribe"
]);

function mkDelta(current: number, previous: number): Delta {
  const pct =
    previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / previous) * 100;
  return { current, previous, pct_change: pct };
}

async function countCallsInRange(
  db: SupabaseClient,
  start: Date,
  end: Date,
  extraFilter?: (q: any) => any
): Promise<number> {
  let q: any = db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .gte("call_timestamp", start.toISOString())
    .lt("call_timestamp", end.toISOString());
  if (extraFilter) q = extraFilter(q);
  const { count } = await q;
  return count ?? 0;
}

async function countRepliesInRange(
  db: SupabaseClient,
  start: Date,
  end: Date
): Promise<number> {
  const { count } = await db
    .from("lemlist_activities")
    .select("id", { count: "exact", head: true })
    .eq("type", "repliedTo")
    .gte("activity_at", start.toISOString())
    .lt("activity_at", end.toISOString());
  return count ?? 0;
}

export async function computeReporteria(
  db: SupabaseClient,
  range: DateRange,
  rangeKey: string
): Promise<ReporteriaSnapshot> {
  const { start, end, previous } = range;

  // 1) Base del dashboard (reuso). Nos da pipeline counts + coverage +
  // usage + evolution_8mo + clay_funnel.
  const dash = await computeDashboard(db, range, rangeKey);

  // 2) Hero KPIs — varios reusan dash, otros los compongo.
  // Empresas trabajadas: clay_pushed_at en período (current y previous).
  const [companiesNowRes, companiesPrevRes] = await Promise.all([
    db
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("clay_pushed_at", start.toISOString())
      .lt("clay_pushed_at", end.toISOString()),
    db
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("clay_pushed_at", previous.start.toISOString())
      .lt("clay_pushed_at", previous.end.toISOString())
  ]);
  const companiesNow = companiesNowRes.count ?? 0;
  const companiesPrev = companiesPrevRes.count ?? 0;

  const [callsNow, callsPrev, repliesNow, repliesPrev, interestedNow, interestedPrev] =
    await Promise.all([
      countCallsInRange(db, start, end),
      countCallsInRange(db, previous.start, previous.end),
      countRepliesInRange(db, start, end),
      countRepliesInRange(db, previous.start, previous.end),
      countCallsInRange(db, start, end, (q) =>
        q.in("customer_response_category", ["interested", "callback_requested"])
      ),
      countCallsInRange(db, previous.start, previous.end, (q) =>
        q.in("customer_response_category", ["interested", "callback_requested"])
      )
    ]);

  // Conversations = llamadas + respuestas (todo lo que tuvo diálogo real).
  const conversationsNow = callsNow + repliesNow;
  const conversationsPrev = callsPrev + repliesPrev;

  // Hot leads = calls interested/callback + respuestas positivas.
  const positiveRepliesNow = await db
    .from("lemlist_activities")
    .select("id", { count: "exact", head: true })
    .eq("type", "repliedTo")
    .in("reply_category", Array.from(POSITIVE_REPLY_CATEGORIES))
    .gte("activity_at", start.toISOString())
    .lt("activity_at", end.toISOString());
  const positiveRepliesPrev = await db
    .from("lemlist_activities")
    .select("id", { count: "exact", head: true })
    .eq("type", "repliedTo")
    .in("reply_category", Array.from(POSITIVE_REPLY_CATEGORIES))
    .gte("activity_at", previous.start.toISOString())
    .lt("activity_at", previous.end.toISOString());

  const hotNow = interestedNow + (positiveRepliesNow.count ?? 0);
  const hotPrev = interestedPrev + (positiveRepliesPrev.count ?? 0);

  const hero = {
    companies_worked: mkDelta(companiesNow, companiesPrev),
    contacts_generated: dash.pipeline.contacts_imported,
    in_outreach: dash.pipeline.contacts_in_lemlist,
    conversations: mkDelta(conversationsNow, conversationsPrev),
    hot_leads: mkDelta(hotNow, hotPrev)
  };

  // 3) Executive funnel — 5 pasos limpios.
  const baseDiscovered = dash.pipeline.companies_discovered.current;
  const baseApproved = dash.pipeline.companies_approved.current;
  const baseContacts = dash.pipeline.contacts_imported.current;
  const baseLemlist = dash.pipeline.contacts_in_lemlist.current;
  const baseConversations = conversationsNow;
  const baseHot = hotNow;

  const safeRate = (n: number, d: number) => (d === 0 ? null : (n / d) * 100);
  const executive_funnel = [
    { step: "Empresas descubiertas", count: baseDiscovered, rate_from_prev: null },
    {
      step: "Empresas aprobadas",
      count: baseApproved,
      rate_from_prev: safeRate(baseApproved, baseDiscovered)
    },
    {
      step: "Contactos generados",
      count: baseContacts,
      rate_from_prev: safeRate(baseContacts, baseApproved)
    },
    {
      step: "En outreach (Lemlist)",
      count: baseLemlist,
      rate_from_prev: safeRate(baseLemlist, baseContacts)
    },
    {
      step: "Conversaciones (calls + respuestas)",
      count: baseConversations,
      rate_from_prev: safeRate(baseConversations, baseLemlist)
    },
    {
      step: "Interesados / callbacks / positivos",
      count: baseHot,
      rate_from_prev: safeRate(baseHot, baseConversations)
    }
  ];

  // 4) Outreach detalle — calls aggregates.
  const { data: callRowsAgg } = await db
    .from("calls")
    .select("duration_ms, sdr_score_overall, customer_response_category")
    .gte("call_timestamp", start.toISOString())
    .lt("call_timestamp", end.toISOString())
    .limit(20000);
  const callRows = (callRowsAgg ?? []) as Array<{
    duration_ms: number | null;
    sdr_score_overall: number | null;
    customer_response_category: string | null;
  }>;
  let durationSum = 0;
  let durationCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let pickupYes = 0;
  let pickupNo = 0;
  for (const c of callRows) {
    if (typeof c.duration_ms === "number" && c.duration_ms > 0) {
      durationSum += c.duration_ms;
      durationCount++;
    }
    if (typeof c.sdr_score_overall === "number") {
      scoreSum += c.sdr_score_overall;
      scoreCount++;
    }
    const cat = c.customer_response_category;
    if (cat && PICKUP_CATEGORIES.has(cat as any)) pickupYes++;
    else if (cat && NO_PICKUP_CATEGORIES.has(cat as any)) pickupNo++;
  }
  const pickupTotal = pickupYes + pickupNo;
  const outreach = {
    leads_in_lemlist: dash.pipeline.contacts_in_lemlist.current,
    calls_made: callRows.length,
    calls_connected: pickupYes,
    avg_duration_sec: durationCount > 0 ? durationSum / durationCount / 1000 : null,
    avg_sdr_score: scoreCount > 0 ? scoreSum / scoreCount : null,
    pickup_rate_pct: pickupTotal > 0 ? (pickupYes / pickupTotal) * 100 : null
  };

  // 5) Respuestas detalle.
  const { data: repliesAgg } = await db
    .from("lemlist_activities")
    .select("reply_category, reply_triage")
    .eq("type", "repliedTo")
    .gte("activity_at", start.toISOString())
    .lt("activity_at", end.toISOString())
    .limit(20000);
  const replyCategoryCounts = new Map<string, number>();
  let positive = 0;
  let negative = 0;
  for (const r of (repliesAgg ?? []) as Array<{
    reply_category: string | null;
    reply_triage: string | null;
  }>) {
    const cat = r.reply_triage || r.reply_category || "other";
    replyCategoryCounts.set(cat, (replyCategoryCounts.get(cat) ?? 0) + 1);
    if (POSITIVE_REPLY_CATEGORIES.has(cat)) positive++;
    else if (NEGATIVE_REPLY_CATEGORIES.has(cat)) negative++;
  }
  const responses = {
    total: repliesAgg?.length ?? 0,
    by_category: Array.from(replyCategoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({
        category,
        label: RESPONSE_LABELS[category] ?? category,
        count
      })),
    positive_count: positive,
    negative_count: negative,
    neutral_count:
      (repliesAgg?.length ?? 0) - positive - negative > 0
        ? (repliesAgg?.length ?? 0) - positive - negative
        : 0
  };

  // 6) Hot leads — top contactos rankeados por señales recientes.
  // Score:
  //   +50 si la última call dio 'interested'
  //   +35 si 'callback_requested'
  //   +30 si respuesta categoría positiva en período
  //   +20 si objection_timing en call (sigue caliente)
  //   + fit_score × 4 (0-40 pts)
  //   +5 si tiene teléfono, +5 si está en Lemlist, +5 si está en HubSpot
  // Excluye status=discarded o human_decision=rejected.
  const { data: hotCandidates } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, fit_score, linkedin_url, " +
        "lemlist_pushed_at, hubspot_contact_id, phone, status, human_decision, " +
        "company_id, companies(company_name)"
    )
    .neq("status", "discarded")
    .neq("human_decision", "rejected")
    .limit(2000);
  type HotRaw = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    fit_score: number | null;
    linkedin_url: string | null;
    lemlist_pushed_at: string | null;
    hubspot_contact_id: string | null;
    phone: string | null;
    company_id: string | null;
    companies: { company_name: string | null } | null;
  };
  const contactById = new Map<string, HotRaw>();
  for (const c of (hotCandidates ?? []) as unknown as HotRaw[]) {
    contactById.set(c.id, c);
  }
  // Última call por contacto.
  const { data: callRowsForHot } = await db
    .from("calls")
    .select("contact_id, customer_response_category, call_timestamp")
    .gte("call_timestamp", previous.start.toISOString())
    .order("call_timestamp", { ascending: false })
    .limit(5000);
  const lastCallByContact = new Map<string, string>();
  for (const r of (callRowsForHot ?? []) as Array<{
    contact_id: string | null;
    customer_response_category: string | null;
  }>) {
    if (!r.contact_id || lastCallByContact.has(r.contact_id)) continue;
    if (r.customer_response_category)
      lastCallByContact.set(r.contact_id, r.customer_response_category);
  }
  // Respuestas positivas en período por contacto.
  const { data: repliesForHot } = await db
    .from("lemlist_activities")
    .select("contact_id, reply_category, reply_triage")
    .eq("type", "repliedTo")
    .gte("activity_at", start.toISOString())
    .lt("activity_at", end.toISOString())
    .limit(5000);
  const recentReplyByContact = new Map<string, string>();
  for (const r of (repliesForHot ?? []) as Array<{
    contact_id: string | null;
    reply_category: string | null;
    reply_triage: string | null;
  }>) {
    if (!r.contact_id || recentReplyByContact.has(r.contact_id)) continue;
    const cat = r.reply_triage || r.reply_category;
    if (cat) recentReplyByContact.set(r.contact_id, cat);
  }

  const ranked: Array<{
    raw: HotRaw;
    score: number;
    signals: string[];
  }> = [];
  for (const c of contactById.values()) {
    const lastCall = lastCallByContact.get(c.id);
    const lastReply = recentReplyByContact.get(c.id);
    let score = 0;
    const signals: string[] = [];
    if (lastCall === "interested") {
      score += 50;
      signals.push("Llamada interesado");
    } else if (lastCall === "callback_requested") {
      score += 35;
      signals.push("Pidió callback");
    } else if (lastCall === "objection_timing") {
      score += 20;
      signals.push("Objeción timing (sigue caliente)");
    }
    if (lastReply && POSITIVE_REPLY_CATEGORIES.has(lastReply)) {
      score += 30;
      signals.push("Respuesta positiva en período");
    } else if (lastReply === "callback_requested") {
      score += 25;
      signals.push("Pidió callback (vía respuesta)");
    }
    if (typeof c.fit_score === "number") {
      score += Math.min(40, c.fit_score * 4);
      if (c.fit_score >= 8) signals.push(`Fit alto (${c.fit_score})`);
    }
    if (c.phone) score += 5;
    if (c.lemlist_pushed_at) score += 5;
    if (c.hubspot_contact_id) score += 5;
    if (score > 0) ranked.push({ raw: c, score, signals });
  }
  ranked.sort((a, b) => b.score - a.score);
  const hot_leads = ranked.slice(0, 10).map((h) => {
    const name =
      [h.raw.first_name, h.raw.last_name].filter(Boolean).join(" ").trim() ||
      "(sin nombre)";
    return {
      contact_id: h.raw.id,
      contact_name: name,
      company_name: h.raw.companies?.company_name ?? null,
      job_title: h.raw.job_title,
      signals: h.signals,
      score: h.score,
      linkedin_url: h.raw.linkedin_url,
      hubspot_contact_id: h.raw.hubspot_contact_id
    };
  });

  // 7) Highlight narrativo.
  const lines: string[] = [];
  lines.push(
    `En ${dash.range.label.toLowerCase()}, prospectamos ${hero.companies_worked.current} empresas y generamos ${hero.contacts_generated.current} contactos calificados.`
  );
  if (hero.in_outreach.current > 0) {
    lines.push(
      `${hero.in_outreach.current} personas ingresaron a campañas activas de outreach (Lemlist).`
    );
  }
  if (outreach.calls_made > 0) {
    lines.push(
      `Hicimos ${outreach.calls_made} llamadas${
        outreach.pickup_rate_pct != null
          ? ` (tasa de pickup ${outreach.pickup_rate_pct.toFixed(0)}%)`
          : ""
      }${
        outreach.avg_sdr_score != null
          ? `, score SDR promedio ${outreach.avg_sdr_score.toFixed(1)}/10`
          : ""
      }.`
    );
  }
  if (responses.total > 0) {
    lines.push(
      `Recibimos ${responses.total} respuestas, de las cuales ${responses.positive_count} fueron positivas y ${responses.negative_count} negativas.`
    );
  }
  if (hero.hot_leads.current > 0) {
    lines.push(
      `Tenemos ${hero.hot_leads.current} hot leads identificados para seguimiento prioritario.`
    );
  }
  const highlight = lines.join(" ");

  return {
    range: dash.range,
    hero,
    executive_funnel,
    outreach,
    responses,
    hot_leads,
    highlight,
    evolution_8mo: dash.evolution_8mo
  };
}
