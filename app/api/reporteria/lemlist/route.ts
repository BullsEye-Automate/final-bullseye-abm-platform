import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ContactEngagement = {
  firstName: string;
  lastName: string;
  companyName: string;
  score: number;
  lastActivityType: string;
  lastActivityAt: string;
};

export type CompanyEngagement = {
  companyName: string;
  contactCount: number;
  replyCount: number;
  totalScore: number;
  bestAction: string;
  temperature: "hot" | "warm" | "cold";
};

export type WeeklyPoint = { label: string; replyRate: number };

export type RecentActivityItem = {
  firstName: string;
  lastName: string;
  companyName: string;
  clientName: string;
  type: string;
  at: string;
};

export type ClientCampaignStats = {
  clientId: string;
  clientName: string;
  campaignName: string;
  campaignId: string;
  sent: number;
  opened: number;
  openRate: number;
  clicked: number;
  replied: number;
  replyRate: number;
  emailReplied: number;
  linkedinReplied: number;
  linkedinAccepted: number;
  bounced: number;
  bounceRate: number;
};

export type LemlistReportData = {
  // KPIs globales
  totalSent: number;
  totalOpened: number;
  openRate: number;
  totalReplied: number;
  replyRate: number;
  totalEmailReplied: number;
  totalLinkedinReplied: number;
  totalLinkedinAccepted: number;
  totalBounced: number;
  bounceRate: number;
  campaignName?: string;  // solo en modo individual
  // Desglose por cliente (modo "todos")
  perClient: ClientCampaignStats[];
  // Contactos y empresas
  topContacts: ContactEngagement[];
  topCompanies: CompanyEngagement[];
  // Tendencia semanal
  weeklyTrend: WeeklyPoint[];
  // Actividad reciente
  recentActivity: RecentActivityItem[];
};

// ─── Scoring de engagement ───────────────────────────────────────────────────

const SCORE_MAP: Record<string, number> = {
  emailsReplied:          10,
  linkedinReplied:         8,
  linkedinInviteAccepted:  5,
  emailsClicked:           3,
  emailsOpened:            1,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com","googlemail.com","hotmail.com","hotmail.cl","outlook.com","outlook.cl",
  "yahoo.com","yahoo.cl","yahoo.es","icloud.com","me.com","live.com","live.cl",
  "msn.com","protonmail.com","proton.me",
]);

async function runInBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function normalizeLeads(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.items && Array.isArray(raw.items)) return raw.items;
  return [];
}

function labelForActivity(type: string): string {
  const map: Record<string, string> = {
    emailsReplied:          "Email reply",
    linkedinReplied:        "LinkedIn reply",
    linkedinInviteAccepted: "LI aceptado",
    emailsClicked:          "Email click",
    emailsOpened:           "Email visto",
  };
  return map[type] ?? type;
}

// ─── Fetch datos de una campaña ───────────────────────────────────────────────

const ACTIVITY_FETCH_TYPES = [
  "emailsOpened",
  "emailsClicked",
  "emailsReplied",
  "linkedinReplied",
  "linkedinInviteAccepted",
  "emailsBounced",
] as const;

// Pagina el endpoint de leads (soporta offset)
async function fetchAllLeads(campaignId: string, headers: Record<string, string>): Promise<any[]> {
  const PAGE = 500;
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${PAGE}&offset=${offset}`,
      { headers }
    ).catch(() => null);
    if (!res || !res.ok) break;
    const data = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
    all.push(...items);
    if (items.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break;
  }
  return all;
}

// Actividades: Lemlist soporta hasta limit=500 (valores mayores devuelven vacío)
async function fetchActivities(type: string, campaignId: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(
    `https://api.lemlist.com/api/activities?type=${type}&campaignId=${campaignId}&limit=500`,
    { headers }
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : (data?.data ?? data?.activities ?? data?.items ?? []);
}

async function fetchCampaign(apiKey: string, campaignId: string, db: any, since?: string) {
  const creds = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${creds}` };

  const [campaign, leads, ...activityPages] = await Promise.all([
    fetch(`https://api.lemlist.com/api/campaigns/${campaignId}`, { headers })
      .then(r => r.ok ? r.json().catch(() => null) : null).catch(() => null),
    fetchAllLeads(campaignId, headers),
    ...ACTIVITY_FETCH_TYPES.map(t => fetchActivities(t, campaignId, headers)),
  ]);

  console.log(`[lemlist] campaña ${campaignId}: ${leads.length} leads`);

  // Actividades por tipo (paginadas completas)
  const activitiesByType: Record<string, any[]> = {};
  for (let i = 0; i < ACTIVITY_FETCH_TYPES.length; i++) {
    activitiesByType[ACTIVITY_FETCH_TYPES[i]] = activityPages[i] ?? [];
    console.log(`[lemlist] ${ACTIVITY_FETCH_TYPES[i]}: ${activitiesByType[ACTIVITY_FETCH_TYPES[i]].length}`);
  }

  // Filtrar actividades por fecha si se pasó `since`
  if (since) {
    for (const type of Object.keys(activitiesByType)) {
      activitiesByType[type] = activitiesByType[type].filter((a: any) => {
        const at = a.createdAt ?? a.date ?? "";
        return at >= since;
      });
    }
  }

  // Contar leads únicos por tipo de actividad
  function uniqueEmails(type: string): Set<string> {
    const s = new Set<string>();
    for (const a of activitiesByType[type] ?? []) {
      const email = (a.email ?? a.leadEmail ?? "").toLowerCase().trim();
      if (email) s.add(email);
    }
    return s;
  }

  const reports = {
    emailsSent:              leads.length,
    emailsOpened:            uniqueEmails("emailsOpened").size,
    emailsClicked:           uniqueEmails("emailsClicked").size,
    emailsReplied:           uniqueEmails("emailsReplied").size,
    linkedinReplied:         uniqueEmails("linkedinReplied").size,
    linkedinInvitesAccepted: uniqueEmails("linkedinInviteAccepted").size,
    emailsBounced:           uniqueEmails("emailsBounced").size,
  };

  // Construir mapa email → {actividades + nombre/empresa de la actividad}
  type EmailData = {
    activities: { type: string; at: string }[];
    firstName: string;
    lastName: string;
    companyName: string;
  };
  const emailData = new Map<string, EmailData>();
  for (const [type, acts] of Object.entries(activitiesByType)) {
    for (const a of acts) {
      const email = (a.email ?? a.leadEmail ?? "").toLowerCase().trim();
      if (!email) continue;
      if (!emailData.has(email)) {
        emailData.set(email, {
          activities: [],
          firstName:   a.leadFirstName   ?? a.firstName   ?? "",
          lastName:    a.leadLastName    ?? a.lastName    ?? "",
          companyName: a.leadCompanyName ?? a.companyName ?? "",
        });
      }
      emailData.get(email)!.activities.push({ type, at: a.createdAt ?? a.date ?? "" });
    }
  }

  // Enriquecer con datos de Supabase contacts (prioridad sobre Lemlist cuando están)
  const emailsArray = Array.from(emailData.keys());
  const contactMap = new Map<string, { firstName: string; lastName: string; companyName: string }>();
  if (emailsArray.length > 0) {
    const { data: supaContacts } = await db
      .from("contacts")
      .select("email, first_name, last_name, companies(company_name)")
      .in("email", emailsArray);
    for (const c of supaContacts ?? []) {
      contactMap.set((c.email ?? "").toLowerCase(), {
        firstName:   c.first_name  ?? "",
        lastName:    c.last_name   ?? "",
        companyName: (c.companies as any)?.company_name ?? "",
      });
    }
  }

  // Construir leadsWithActivities para scoring
  const leadsWithActivities = Array.from(emailData.entries()).map(([email, data]) => {
    const contact = contactMap.get(email);
    const domain  = email.split("@")[1] ?? "";
    return {
      email,
      firstName:   contact?.firstName  || data.firstName  || "",
      lastName:    contact?.lastName   || data.lastName   || "",
      companyName: contact?.companyName || data.companyName || (PERSONAL_EMAIL_DOMAINS.has(domain) ? "" : domain),
      activities:  data.activities,
    };
  });

  return {
    reports,
    leads: leadsWithActivities,
    campaignName: campaign?.name ?? campaignId,
  };
}

// ─── Computar engagement ──────────────────────────────────────────────────────

function computeEngagement(leads: any[], clientName: string) {
  // Por contacto
  const contacts: ContactEngagement[] = leads.map((lead) => {
    const activities: any[] = lead.activities ?? [];
    let score = 0;
    let lastActivity: { type: string; at: string } | null = null;
    for (const act of activities) {
      const pts = SCORE_MAP[act.type] ?? 0;
      score += pts;
      if (pts > 0 && (!lastActivity || act.at > lastActivity.at)) {
        lastActivity = { type: act.type, at: act.at };
      }
    }
    const firstName = lead.firstName ?? lead.first_name ?? "";
    const lastName  = lead.lastName  ?? lead.last_name  ?? "";
    const displayName = (firstName || lastName) ? null : (lead.email ?? "");
    return {
      firstName: displayName ? displayName : firstName,
      lastName:  displayName ? ""           : lastName,
      companyName: lead.companyName ?? lead.company ?? "",
      score,
      lastActivityType: lastActivity?.type ?? "",
      lastActivityAt: lastActivity?.at ?? "",
    };
  }).sort((a, b) => b.score - a.score).slice(0, 10);

  // Por empresa
  const coMap = new Map<string, { contactCount: number; replyCount: number; totalScore: number; bestAction: string }>();
  for (const lead of leads) {
    const co = lead.companyName || "Sin empresa";
    const activities: any[] = lead.activities ?? [];
    let score = 0;
    let hasReply = false;
    let bestAction = "";
    for (const act of activities) {
      const pts = SCORE_MAP[act.type] ?? 0;
      score += pts;
      if (act.type === "emailsReplied" || act.type === "linkedinReplied") hasReply = true;
      if (!bestAction && pts >= 5) bestAction = act.type;
    }
    if (!bestAction) {
      for (const act of activities) { if (SCORE_MAP[act.type]) { bestAction = act.type; break; } }
    }
    const ex = coMap.get(co) ?? { contactCount: 0, replyCount: 0, totalScore: 0, bestAction: "" };
    coMap.set(co, {
      contactCount: ex.contactCount + 1,
      replyCount: ex.replyCount + (hasReply ? 1 : 0),
      totalScore: ex.totalScore + score,
      bestAction: ex.bestAction || bestAction,
    });
  }
  const topCompanies: CompanyEngagement[] = Array.from(coMap.entries())
    .map(([companyName, d]) => ({
      companyName,
      contactCount: d.contactCount,
      replyCount: d.replyCount,
      totalScore: d.totalScore,
      bestAction: labelForActivity(d.bestAction),
      temperature: (d.replyCount > 0 ? "hot" : d.totalScore > 5 ? "warm" : "cold") as "hot" | "warm" | "cold",
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10);

  // Tendencia semanal (últimas 8 semanas)
  const now = new Date();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getTime() - (7 - i) * 7 * 86400000);
    return { weekNum: getISOWeek(d), year: d.getFullYear(), label: `Sem ${i + 1}`, replies: 0, sent: 0 };
  });
  const totalLeads = leads.length || 1;
  for (const lead of leads) {
    for (const act of lead.activities ?? []) {
      if (!act.at) continue;
      const d = new Date(act.at);
      const wn = getISOWeek(d);
      const yr = d.getFullYear();
      const wk = weeks.find(w => w.weekNum === wn && w.year === yr);
      if (!wk) continue;
      if (act.type === "emailsReplied" || act.type === "linkedinReplied") wk.replies++;
    }
  }
  const weeklyTrend: WeeklyPoint[] = weeks.map(w => ({
    label: w.label,
    replyRate: Math.round((w.replies / totalLeads) * 1000) / 10,
  }));

  // Actividad reciente (eventos de alto valor, los 6 más recientes)
  const allActs: RecentActivityItem[] = [];
  for (const lead of leads) {
    for (const act of lead.activities ?? []) {
      if ((SCORE_MAP[act.type] ?? 0) >= 5) {
        const fn = lead.firstName ?? lead.first_name ?? "";
        const ln = lead.lastName  ?? lead.last_name  ?? "";
        const actEmailDomain = lead.email ? lead.email.split("@")[1] ?? "" : "";
        allActs.push({
          firstName: (fn || ln) ? fn : (lead.email ?? ""),
          lastName:  (fn || ln) ? ln : "",
          companyName: lead.companyName ?? lead.company ?? actEmailDomain,
          clientName,
          type: act.type,
          at: act.at ?? "",
        });
      }
    }
  }
  allActs.sort((a, b) => b.at.localeCompare(a.at));
  const recentActivity = allActs.slice(0, 6);

  return { contacts, topCompanies, weeklyTrend, recentActivity };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  const since    = searchParams.get("since") ?? undefined;

  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const isAll = clientId === "__all__";

  try {
    // Clientes a procesar: {id, name, apiKey, campaignIds[]}
    type ClientEntry = { id: string; name: string; apiKey: string; campaignIds: string[] };
    let clientEntries: ClientEntry[] = [];

    const clientIds = isAll
      ? (await db.from("clients").select("id, name").eq("is_active", true)).data?.map((c: any) => c.id) ?? []
      : [clientId];

    if (!clientIds.length) return NextResponse.json({ error: "No hay clientes activos" }, { status: 404 });

    const [clientsData, configsData, assignedData] = await Promise.all([
      db.from("clients").select("id, name").in("id", clientIds),
      db.from("client_configs").select("client_id, lemlist_api_key").in("client_id", clientIds),
      db.from("client_lemlist_campaigns").select("client_id, campaign_id").in("client_id", clientIds).eq("is_active", true),
    ]);

    for (const cl of clientsData.data ?? []) {
      const cfg = configsData.data?.find((c: any) => c.client_id === cl.id);
      const apiKey = cfg?.lemlist_api_key ?? process.env.LEMLIST_API_KEY ?? "";
      if (!apiKey) continue;

      // Campañas de la nueva tabla
      const campaignIds = (assignedData.data ?? [])
        .filter((r: any) => r.client_id === cl.id)
        .map((r: any) => r.campaign_id as string);

      if (!campaignIds.length) continue;
      clientEntries.push({ id: cl.id, name: cl.name, apiKey, campaignIds });
    }

    if (!clientEntries.length) {
      return NextResponse.json({ error: "Ningún cliente tiene campañas Lemlist configuradas" }, { status: 404 });
    }

    // Fetch: por cada cliente, fetch de campañas en lotes de 4 para evitar rate limiting
    const results = await runInBatches(clientEntries, 2, async (cl) => {
      const campaignResults = await runInBatches(
        cl.campaignIds, 4,
        (cid) => fetchCampaign(cl.apiKey, cid, db, since).catch(() => null)
      );
      const valid = campaignResults.filter(Boolean) as NonNullable<(typeof campaignResults)[0]>[];
      if (!valid.length) return null;

      // Merge campañas del mismo cliente
      const mergedReports = {
        emailsSent:              valid.reduce((s, v) => s + v.reports.emailsSent, 0),
        emailsOpened:            valid.reduce((s, v) => s + v.reports.emailsOpened, 0),
        emailsClicked:           valid.reduce((s, v) => s + v.reports.emailsClicked, 0),
        emailsReplied:           valid.reduce((s, v) => s + v.reports.emailsReplied, 0),
        linkedinReplied:         valid.reduce((s, v) => s + v.reports.linkedinReplied, 0),
        linkedinInvitesAccepted: valid.reduce((s, v) => s + v.reports.linkedinInvitesAccepted, 0),
        emailsBounced:           valid.reduce((s, v) => s + v.reports.emailsBounced, 0),
      };
      const mergedLeads = valid.flatMap((v) => v.leads);
      const campaignName = valid.length === 1 ? valid[0].campaignName : `${valid.length} campañas`;

      const eng = computeEngagement(mergedLeads, cl.name);
      return { cl, reports: mergedReports, leads: mergedLeads, campaignName, eng };
    });
    const valid = results.filter(Boolean) as NonNullable<(typeof results)[0]>[];

    if (!valid.length) return NextResponse.json({ error: "No se pudo obtener datos de Lemlist" }, { status: 502 });

    // Agregar totales
    let totalSent = 0, totalOpened = 0, totalReplied = 0;
    let totalEmailReplied = 0, totalLinkedinReplied = 0, totalLinkedinAccepted = 0, totalBounced = 0;

    const perClient: ClientCampaignStats[] = valid.map(({ cl, reports, campaignName }) => {
      const sent     = reports.emailsSent ?? 0;
      const opened   = reports.emailsOpened ?? 0;
      const replied  = (reports.emailsReplied ?? 0) + (reports.linkedinReplied ?? 0);
      const emailR   = reports.emailsReplied ?? 0;
      const liR      = reports.linkedinReplied ?? 0;
      const liA      = reports.linkedinInvitesAccepted ?? 0;
      const bounced  = reports.emailsBounced ?? 0;

      totalSent             += sent;
      totalOpened           += opened;
      totalReplied          += replied;
      totalEmailReplied     += emailR;
      totalLinkedinReplied  += liR;
      totalLinkedinAccepted += liA;
      totalBounced          += bounced;

      return {
        clientId: cl.id,
        clientName: cl.name,
        campaignName,
        campaignId: cl.campaignIds[0] ?? "",
        sent,
        opened,
        openRate:     sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
        clicked:      reports.emailsClicked ?? 0,
        replied,
        replyRate:    sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
        emailReplied: emailR,
        linkedinReplied: liR,
        linkedinAccepted: liA,
        bounced,
        bounceRate:   sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
      };
    });

    // Combinar contactos, empresas, actividad de todos los clientes
    const allContacts = valid.flatMap(v => v.eng.contacts);
    const allCompanies = valid.flatMap(v => v.eng.topCompanies);
    const allActivity = valid.flatMap(v => v.eng.recentActivity);

    // Merge companies across clients
    const coMerge = new Map<string, CompanyEngagement>();
    for (const co of allCompanies) {
      const ex = coMerge.get(co.companyName);
      if (!ex) { coMerge.set(co.companyName, { ...co }); continue; }
      coMerge.set(co.companyName, {
        ...ex,
        contactCount: ex.contactCount + co.contactCount,
        replyCount: ex.replyCount + co.replyCount,
        totalScore: ex.totalScore + co.totalScore,
        temperature: ((ex.replyCount + co.replyCount) > 0 ? "hot" : (ex.totalScore + co.totalScore) > 5 ? "warm" : "cold") as "hot" | "warm" | "cold",
      });
    }

    // Weekly trend global (average across clients)
    const globalTrend: WeeklyPoint[] = valid[0].eng.weeklyTrend.map((_: any, i: number) => ({
      label: valid[0].eng.weeklyTrend[i].label,
      replyRate: Math.round(
        valid.reduce((s, v) => s + (v.eng.weeklyTrend[i]?.replyRate ?? 0), 0) / valid.length * 10
      ) / 10,
    }));

    const payload: LemlistReportData = {
      totalSent,
      totalOpened,
      openRate:     totalSent > 0 ? Math.round((totalOpened / totalSent) * 1000) / 10 : 0,
      totalReplied,
      replyRate:    totalSent > 0 ? Math.round((totalReplied / totalSent) * 1000) / 10 : 0,
      totalEmailReplied,
      totalLinkedinReplied,
      totalLinkedinAccepted,
      totalBounced,
      bounceRate:   totalSent > 0 ? Math.round((totalBounced / totalSent) * 1000) / 10 : 0,
      campaignName: valid.length === 1 ? valid[0].campaignName : undefined,
      perClient,
      topContacts: allContacts.sort((a, b) => b.score - a.score).slice(0, 10),
      topCompanies: Array.from(coMerge.values()).sort((a, b) => b.totalScore - a.totalScore).slice(0, 10),
      weeklyTrend: globalTrend,
      recentActivity: allActivity.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("[reporteria/lemlist]", e);
    return NextResponse.json({ error: e?.message ?? "Error interno" }, { status: 500 });
  }
}
