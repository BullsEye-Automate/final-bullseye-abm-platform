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

async function fetchCampaign(apiKey: string, campaignId: string) {
  const creds = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${creds}` };

  // Usar /api/activities (patrón probado en el proyecto) + leads para nombre/empresa
  const settled = await Promise.allSettled([
    fetch(`https://api.lemlist.com/api/campaigns/${campaignId}`, { headers }),
    fetch(`https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=500&offset=0`, { headers }),
    ...ACTIVITY_FETCH_TYPES.map(t =>
      fetch(`https://api.lemlist.com/api/activities?type=${t}&campaignId=${campaignId}&limit=500`, { headers })
    ),
  ]);

  const campaign = settled[0].status === "fulfilled" && settled[0].value.ok
    ? await settled[0].value.json().catch(() => null) : null;

  const leadsRes = settled[1];
  const leadsRaw = leadsRes.status === "fulfilled" && leadsRes.value.ok
    ? await leadsRes.value.json().catch(() => null) : null;
  if (leadsRes.status === "fulfilled" && !leadsRes.value.ok) {
    console.error(`[lemlist] leads HTTP ${leadsRes.value.status} para campaña ${campaignId}`);
  }
  // Log de estructura cruda para diagnosticar el formato de la respuesta
  console.log(`[lemlist] leads raw keys:`, leadsRaw ? Object.keys(leadsRaw).join(", ") : "null/vacío",
    "| isArray:", Array.isArray(leadsRaw), "| length:", Array.isArray(leadsRaw) ? leadsRaw.length : "N/A");
  const leads = normalizeLeads(leadsRaw);
  console.log(`[lemlist] campaña ${campaignId}: ${leads.length} leads normalizados`);

  // Construir mapa de leads por email para lookup rápido
  const leadsMap = new Map<string, any>();
  for (const lead of leads) {
    const email = (lead.email ?? "").toLowerCase().trim();
    if (email) leadsMap.set(email, lead);
  }

  // Parsear actividades por tipo
  const activitiesByType: Record<string, any[]> = {};
  for (let i = 0; i < ACTIVITY_FETCH_TYPES.length; i++) {
    const result = settled[i + 2];
    if (result.status === "fulfilled" && result.value.ok) {
      const data = await result.value.json().catch(() => null);
      const items: any[] = Array.isArray(data) ? data : (data?.data ?? data?.activities ?? data?.items ?? []);
      activitiesByType[ACTIVITY_FETCH_TYPES[i]] = items;
      console.log(`[lemlist] ${ACTIVITY_FETCH_TYPES[i]}: ${items.length} actividades`);
    } else {
      const status = result.status === "fulfilled" ? result.value.status : "rejected";
      console.error(`[lemlist] ${ACTIVITY_FETCH_TYPES[i]} falló: ${status}`);
      activitiesByType[ACTIVITY_FETCH_TYPES[i]] = [];
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

  // Reconstruir leads con sus actividades para scoring de engagement
  const leadsWithActivities = leads.map((lead: any) => {
    const email = (lead.email ?? "").toLowerCase().trim();
    const activities: { type: string; at: string }[] = [];
    for (const [type, acts] of Object.entries(activitiesByType)) {
      for (const a of acts) {
        if ((a.email ?? a.leadEmail ?? "").toLowerCase().trim() === email) {
          activities.push({ type, at: a.createdAt ?? a.date ?? "" });
        }
      }
    }
    return { ...lead, activities };
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
    return {
      firstName: lead.firstName ?? "",
      lastName: lead.lastName ?? "",
      companyName: lead.companyName ?? "",
      score,
      lastActivityType: lastActivity?.type ?? "",
      lastActivityAt: lastActivity?.at ?? "",
    };
  }).sort((a, b) => b.score - a.score).slice(0, 10);

  // Por empresa
  const coMap = new Map<string, { contactCount: number; replyCount: number; totalScore: number; bestAction: string }>();
  for (const lead of leads) {
    const co = lead.companyName || "Desconocida";
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
  for (const lead of leads) {
    for (const act of lead.activities ?? []) {
      if (!act.at) continue;
      const d = new Date(act.at);
      const wn = getISOWeek(d);
      const yr = d.getFullYear();
      const wk = weeks.find(w => w.weekNum === wn && w.year === yr);
      if (!wk) continue;
      if (act.type === "emailsSent") wk.sent++;
      if (act.type === "emailsReplied" || act.type === "linkedinReplied") wk.replies++;
    }
  }
  const weeklyTrend: WeeklyPoint[] = weeks.map(w => ({
    label: w.label,
    replyRate: w.sent > 0 ? Math.round((w.replies / w.sent) * 1000) / 10 : 0,
  }));

  // Actividad reciente (eventos de alto valor, los 6 más recientes)
  const allActs: RecentActivityItem[] = [];
  for (const lead of leads) {
    for (const act of lead.activities ?? []) {
      if ((SCORE_MAP[act.type] ?? 0) >= 5) {
        allActs.push({
          firstName: lead.firstName ?? "",
          lastName: lead.lastName ?? "",
          companyName: lead.companyName ?? "",
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

  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const isAll = clientId === "__all__";

  try {
    // Clientes a procesar
    let clientRows: { id: string; name: string; lemlist_campaign_id: string | null; lemlist_api_key: string | null }[] = [];

    if (isAll) {
      const { data: clients } = await db.from("clients").select("id, name").eq("is_active", true);
      if (!clients?.length) return NextResponse.json({ error: "No hay clientes activos" }, { status: 404 });

      const { data: configs } = await db
        .from("client_configs")
        .select("client_id, lemlist_campaign_id, lemlist_api_key")
        .in("client_id", clients.map((c: { id: string }) => c.id));

      clientRows = clients.flatMap((cl: { id: string; name: string }) => {
        const cfg = configs?.find((c: { client_id: string }) => c.client_id === cl.id);
        if (!cfg?.lemlist_campaign_id) return [];
        return [{ id: cl.id, name: cl.name, lemlist_campaign_id: cfg.lemlist_campaign_id, lemlist_api_key: cfg.lemlist_api_key }];
      });
    } else {
      const { data: cfg } = await db
        .from("client_configs")
        .select("lemlist_campaign_id, lemlist_api_key")
        .eq("client_id", clientId)
        .maybeSingle();

      if (!cfg?.lemlist_campaign_id) {
        return NextResponse.json({ error: "No hay campaña Lemlist configurada para este cliente" }, { status: 404 });
      }

      const { data: cl } = await db.from("clients").select("name").eq("id", clientId).maybeSingle();
      clientRows = [{ id: clientId, name: cl?.name ?? clientId, lemlist_campaign_id: cfg.lemlist_campaign_id, lemlist_api_key: cfg.lemlist_api_key }];
    }

    if (!clientRows.length) {
      return NextResponse.json({ error: "Ningún cliente tiene campaña Lemlist configurada" }, { status: 404 });
    }

    // Fetch en paralelo para todos los clientes
    const results = await Promise.all(clientRows.map(async (cl) => {
      const apiKey = cl.lemlist_api_key ?? process.env.LEMLIST_API_KEY ?? "";
      if (!apiKey) return null;
      const { reports, leads, campaignName } = await fetchCampaign(apiKey, cl.lemlist_campaign_id!);
      const eng = computeEngagement(leads, cl.name);
      return { cl, reports, leads, campaignName, eng };
    }));
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
        campaignId: cl.lemlist_campaign_id!,
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
    const globalTrend: WeeklyPoint[] = valid[0].eng.weeklyTrend.map((_, i) => ({
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
