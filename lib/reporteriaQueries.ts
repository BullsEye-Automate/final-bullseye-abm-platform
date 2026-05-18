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
import { computeEngagementScoresBatch } from "./contactEngagement";

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
    emails_sent: number;
    linkedin_invitations: number;
    linkedin_messages: number;
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
    fit_score: number | null;
    engagement_score: number;
    last_activity_at: string | null;
    linkedin_url: string | null;
    hubspot_contact_id: string | null;
    /** Score combinado para el orden por defecto. */
    score: number;
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

  // Hot leads = contactos ÚNICOS con engagement real (call interesado/
  // callback en cualquier momento + respuesta positiva en período).
  // Mismo criterio que la tabla de hot leads abajo, para que los números
  // coincidan.
  const [positiveRepliesContactsNow, positiveRepliesContactsPrev] = await Promise.all([
    db
      .from("lemlist_activities")
      .select("contact_id")
      .eq("type", "repliedTo")
      .in("reply_category", Array.from(POSITIVE_REPLY_CATEGORIES))
      .gte("activity_at", start.toISOString())
      .lt("activity_at", end.toISOString()),
    db
      .from("lemlist_activities")
      .select("contact_id")
      .eq("type", "repliedTo")
      .in("reply_category", Array.from(POSITIVE_REPLY_CATEGORIES))
      .gte("activity_at", previous.start.toISOString())
      .lt("activity_at", previous.end.toISOString())
  ]);
  const [interestedCallContactsNow, interestedCallContactsPrev] = await Promise.all([
    db
      .from("calls")
      .select("contact_id")
      .in("customer_response_category", ["interested", "callback_requested"])
      .gte("call_timestamp", start.toISOString())
      .lt("call_timestamp", end.toISOString()),
    db
      .from("calls")
      .select("contact_id")
      .in("customer_response_category", ["interested", "callback_requested"])
      .gte("call_timestamp", previous.start.toISOString())
      .lt("call_timestamp", previous.end.toISOString())
  ]);
  const uniqueIdsNow = new Set<string>();
  for (const r of (positiveRepliesContactsNow.data ?? []) as Array<{ contact_id: string | null }>)
    if (r.contact_id) uniqueIdsNow.add(r.contact_id);
  for (const r of (interestedCallContactsNow.data ?? []) as Array<{ contact_id: string | null }>)
    if (r.contact_id) uniqueIdsNow.add(r.contact_id);
  const uniqueIdsPrev = new Set<string>();
  for (const r of (positiveRepliesContactsPrev.data ?? []) as Array<{ contact_id: string | null }>)
    if (r.contact_id) uniqueIdsPrev.add(r.contact_id);
  for (const r of (interestedCallContactsPrev.data ?? []) as Array<{ contact_id: string | null }>)
    if (r.contact_id) uniqueIdsPrev.add(r.contact_id);

  const hotNow = uniqueIdsNow.size;
  const hotPrev = uniqueIdsPrev.size;

  const hero = {
    companies_worked: mkDelta(companiesNow, companiesPrev),
    // Solo cuenta los contactos fit (pre-filtro YES) — los que valen para
    // outreach. El crudo de Clay (con la mayoría descartada) sigue visible
    // en el embudo ejecutivo como paso intermedio.
    contacts_generated: dash.pipeline.contacts_yes,
    in_outreach: dash.pipeline.contacts_in_lemlist,
    conversations: mkDelta(conversationsNow, conversationsPrev),
    hot_leads: mkDelta(hotNow, hotPrev)
  };

  // 3) Executive funnel — pasos limpios.
  const baseDiscovered = dash.pipeline.companies_discovered.current;
  const baseApproved = dash.pipeline.companies_approved.current;
  const baseContactsTotal = dash.pipeline.contacts_imported.current; // total levantado
  const baseContactsFit = dash.pipeline.contacts_yes.current; // pasaron pre-filter
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
      step: "Contactos levantados (Clay)",
      count: baseContactsTotal,
      rate_from_prev: null
    },
    {
      step: "Contactos fit (pasaron pre-filtro)",
      count: baseContactsFit,
      rate_from_prev: safeRate(baseContactsFit, baseContactsTotal)
    },
    {
      step: "En outreach (correo + LinkedIn)",
      count: baseLemlist,
      rate_from_prev: safeRate(baseLemlist, baseContactsFit)
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

  // 4) Outreach detalle — calls aggregates + breakdown de mensajes
  // enviados (correos, invitaciones LinkedIn, mensajes LinkedIn).
  const [callRowsAggRes, outreachActivitiesRes] = await Promise.all([
    db
      .from("calls")
      .select("duration_ms, sdr_score_overall, customer_response_category")
      .gte("call_timestamp", start.toISOString())
      .lt("call_timestamp", end.toISOString())
      .limit(20000),
    db
      .from("lemlist_activities")
      .select("type, channel")
      .gte("activity_at", start.toISOString())
      .lt("activity_at", end.toISOString())
      .limit(50000)
  ]);
  const callRowsAgg = callRowsAggRes.data;

  // Contar emails enviados, invitaciones LinkedIn, mensajes LinkedIn.
  let emails_sent = 0;
  let linkedin_invitations = 0;
  let linkedin_messages = 0;
  for (const a of (outreachActivitiesRes.data ?? []) as Array<{
    type: string | null;
    channel: string | null;
  }>) {
    const t = (a.type ?? "").toLowerCase();
    if (t.startsWith("emailssent") || t === "emailsent" || t === "emailsdelivered")
      emails_sent++;
    else if (t === "linkedininvite" || t === "linkedininvitedelivered")
      linkedin_invitations++;
    else if (t === "linkedinsend" || t === "linkedinmessage" || t === "linkedinchatmessage")
      linkedin_messages++;
  }
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
    emails_sent,
    linkedin_invitations,
    linkedin_messages,
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

  // 6) Hot leads — basado en engagement score de Lemlist (alta interacción).
  // Filtro: contactos con engagement >= 20 (alguna señal real de interacción:
  // open, click, invite aceptada, respuesta, o call con resultado).
  // Sort: engagement DESC primero (interacción manda), fit_score DESC después
  // como desempate.
  // El frontend permite cambiar el orden a fit_score primario.
  const { data: hotCandidates } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, fit_score, linkedin_url, " +
        "lemlist_pushed_at, hubspot_contact_id, phone, status, human_decision, " +
        "company_id, companies(company_name)"
    )
    .neq("status", "discarded")
    .neq("human_decision", "rejected")
    .not("lemlist_pushed_at", "is", null) // tiene que estar en outreach
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
  const candidates = (hotCandidates ?? []) as unknown as HotRaw[];

  // Calculamos engagement en batch (2 queries totales para todos los
  // contactos, no 2N).
  const engagementMap = await computeEngagementScoresBatch(
    db,
    candidates.map((c) => c.id)
  );

  // Última call por contacto (para mostrar señal en la tabla).
  const { data: callRowsForHot } = await db
    .from("calls")
    .select("contact_id, customer_response_category, call_timestamp")
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
  // Última respuesta positiva por contacto.
  const { data: repliesForHot } = await db
    .from("lemlist_activities")
    .select("contact_id, reply_category, reply_triage, activity_at")
    .eq("type", "repliedTo")
    .order("activity_at", { ascending: false })
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
    engagement: number;
    last_activity_at: string | null;
    signals: string[];
  }> = [];
  for (const c of candidates) {
    const eng = engagementMap.get(c.id);
    if (!eng || eng.score < 20) continue; // solo los que tuvieron alguna interacción real

    const signals: string[] = [];
    const lastCall = lastCallByContact.get(c.id);
    const lastReply = recentReplyByContact.get(c.id);

    if (lastCall === "interested") signals.push("Llamada interesado");
    else if (lastCall === "callback_requested") signals.push("Pidió callback");
    else if (lastCall === "objection_timing") signals.push("Objeción timing");

    if (lastReply && POSITIVE_REPLY_CATEGORIES.has(lastReply))
      signals.push("Respuesta positiva");
    else if (lastReply === "callback_requested")
      signals.push("Callback vía respuesta");

    if (eng.breakdown.email >= 30) signals.push("Alto engagement email");
    if (eng.breakdown.linkedin >= 30) signals.push("Alto engagement LinkedIn");
    if (typeof c.fit_score === "number" && c.fit_score >= 8)
      signals.push(`Fit alto (${c.fit_score})`);

    ranked.push({
      raw: c,
      engagement: eng.score,
      last_activity_at: eng.last_activity_at,
      signals: signals.length > 0 ? signals : ["Engagement Lemlist"]
    });
  }
  // Orden default: engagement DESC, fit_score DESC. El frontend reordena.
  ranked.sort((a, b) => {
    if (b.engagement !== a.engagement) return b.engagement - a.engagement;
    return (b.raw.fit_score ?? 0) - (a.raw.fit_score ?? 0);
  });
  const hot_leads = ranked.slice(0, 25).map((h) => {
    const name =
      [h.raw.first_name, h.raw.last_name].filter(Boolean).join(" ").trim() ||
      "(sin nombre)";
    return {
      contact_id: h.raw.id,
      contact_name: name,
      company_name: h.raw.companies?.company_name ?? null,
      job_title: h.raw.job_title,
      signals: h.signals,
      fit_score: h.raw.fit_score,
      engagement_score: h.engagement,
      last_activity_at: h.last_activity_at,
      score: h.engagement + (h.raw.fit_score ?? 0) * 2, // combinado, para compat
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
