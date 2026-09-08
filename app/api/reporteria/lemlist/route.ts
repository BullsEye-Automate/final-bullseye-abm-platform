import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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
  campaignName?: string;
  perClient: ClientCampaignStats[];
  topContacts: ContactEngagement[];
  topCompanies: CompanyEngagement[];
  weeklyTrend: WeeklyPoint[];
  recentActivity: RecentActivityItem[];
  _needsSync?: boolean;
  _lastSyncedAt?: string | null;
};

// ─── Scoring ─────────────────────────────────────────────────────────────────

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

// ─── Computar engagement ──────────────────────────────────────────────────────

function computeEngagement(
  leadsWithActivities: { email: string; firstName: string; lastName: string; companyName: string; activities: { type: string; at: string }[] }[],
  clientName: string
) {
  const contacts: ContactEngagement[] = leadsWithActivities.map((lead) => {
    let score = 0;
    let lastActivity: { type: string; at: string } | null = null;
    for (const act of lead.activities) {
      const pts = SCORE_MAP[act.type] ?? 0;
      score += pts;
      if (pts > 0 && (!lastActivity || act.at > lastActivity.at)) {
        lastActivity = { type: act.type, at: act.at };
      }
    }
    const fn = lead.firstName;
    const ln = lead.lastName;
    const displayName = (fn || ln) ? null : lead.email;
    return {
      firstName: displayName ? displayName : fn,
      lastName:  displayName ? ""           : ln,
      companyName: lead.companyName,
      score,
      lastActivityType: lastActivity?.type ?? "",
      lastActivityAt: lastActivity?.at ?? "",
    };
  }).sort((a, b) => b.score - a.score).slice(0, 10);

  const coMap = new Map<string, { contactCount: number; replyCount: number; totalScore: number; bestAction: string }>();
  for (const lead of leadsWithActivities) {
    const co = lead.companyName || "Sin empresa";
    let score = 0;
    let hasReply = false;
    let bestAction = "";
    for (const act of lead.activities) {
      const pts = SCORE_MAP[act.type] ?? 0;
      score += pts;
      if (act.type === "emailsReplied" || act.type === "linkedinReplied") hasReply = true;
      if (!bestAction && pts >= 5) bestAction = act.type;
    }
    if (!bestAction) {
      for (const act of lead.activities) { if (SCORE_MAP[act.type]) { bestAction = act.type; break; } }
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

  const now = new Date();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getTime() - (7 - i) * 7 * 86400000);
    return { weekNum: getISOWeek(d), year: d.getFullYear(), label: `Sem ${i + 1}`, replies: 0 };
  });
  const totalLeads = leadsWithActivities.length || 1;
  for (const lead of leadsWithActivities) {
    for (const act of lead.activities) {
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

  const allActs: RecentActivityItem[] = [];
  for (const lead of leadsWithActivities) {
    for (const act of lead.activities) {
      if ((SCORE_MAP[act.type] ?? 0) >= 5) {
        const fn = lead.firstName;
        const ln = lead.lastName;
        const actEmailDomain = lead.email ? lead.email.split("@")[1] ?? "" : "";
        allActs.push({
          firstName: (fn || ln) ? fn : lead.email,
          lastName:  (fn || ln) ? ln : "",
          companyName: lead.companyName || actEmailDomain,
          clientName,
          type: act.type,
          at: act.at,
        });
      }
    }
  }
  allActs.sort((a, b) => b.at.localeCompare(a.at));
  const recentActivity = allActs.slice(0, 6);

  return { contacts, topCompanies, weeklyTrend, recentActivity };
}

// ─── Construir leads desde actividades de Supabase ────────────────────────────

function buildLeadsFromActivities(
  activities: any[],
  contactMap: Map<string, { firstName: string; lastName: string; companyName: string }>
) {
  const emailData = new Map<string, {
    activities: { type: string; at: string }[];
    firstName: string;
    lastName: string;
    companyName: string;
  }>();

  for (const a of activities) {
    const email = (a.lead_email ?? "").toLowerCase().trim();
    if (!email) continue;
    if (!emailData.has(email)) {
      emailData.set(email, {
        activities: [],
        firstName:   a.lead_first_name   ?? "",
        lastName:    a.lead_last_name    ?? "",
        companyName: a.lead_company_name ?? "",
      });
    }
    emailData.get(email)!.activities.push({ type: a.type, at: a.created_at ?? "" });
  }

  return Array.from(emailData.entries()).map(([email, data]) => {
    const contact = contactMap.get(email);
    const domain  = email.split("@")[1] ?? "";
    return {
      email,
      firstName:   contact?.firstName   || data.firstName   || "",
      lastName:    contact?.lastName    || data.lastName    || "",
      companyName: contact?.companyName || data.companyName || (PERSONAL_EMAIL_DOMAINS.has(domain) ? "" : domain),
      activities:  data.activities,
    };
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  const since    = searchParams.get("since") ?? undefined;
  const force    = searchParams.get("force") === "1";

  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const isAll = clientId === "__all__";

  // Caché — clave diferente de la versión anterior (prefijo "db:") para no mezclar con datos viejos
  const cacheKey = since ? `db:since:${since.slice(0, 10)}` : "db:all";
  const cacheTTL = force ? 5 : 60;
  const { data: cached } = await db
    .from("lemlist_report_cache")
    .select("data, fetched_at")
    .eq("client_id", clientId)
    .eq("period", cacheKey)
    .single();
  if (cached) {
    const ageMin = (Date.now() - new Date(cached.fetched_at).getTime()) / 60000;
    if (ageMin < cacheTTL) {
      return NextResponse.json({ ...cached.data, _cached: true, _ageMin: Math.round(ageMin) });
    }
  }

  try {
    const clientIds = isAll
      ? (await db.from("clients").select("id").eq("is_active", true)).data?.map((c: any) => c.id) ?? []
      : [clientId];

    if (!clientIds.length) return NextResponse.json({ error: "No hay clientes activos" }, { status: 404 });

    const [clientsData, assignedData, syncLogData] = await Promise.all([
      db.from("clients").select("id, name").in("id", clientIds),
      db.from("client_lemlist_campaigns").select("client_id, campaign_id, campaign_name").in("client_id", clientIds).eq("is_active", true),
      db.from("lemlist_sync_log").select("client_id, last_synced_at").in("client_id", clientIds),
    ]);

    const clientMap = new Map<string, string>(
      (clientsData.data ?? []).map((c: any) => [c.id, c.name])
    );
    const syncMap = new Map<string, string | null>(
      (syncLogData.data ?? []).map((s: any) => [s.client_id, s.last_synced_at])
    );

    const campaignsByClient = new Map<string, { campaignId: string; campaignName: string | null }[]>();
    for (const r of (assignedData.data ?? [])) {
      if (!campaignsByClient.has(r.client_id)) campaignsByClient.set(r.client_id, []);
      campaignsByClient.get(r.client_id)!.push({ campaignId: r.campaign_id, campaignName: r.campaign_name });
    }

    const perClient: ClientCampaignStats[] = [];
    let totalSent = 0, totalOpened = 0, totalReplied = 0;
    let totalEmailReplied = 0, totalLinkedinReplied = 0, totalLinkedinAccepted = 0, totalBounced = 0;

    const allLeadsWithActivities: ReturnType<typeof buildLeadsFromActivities> = [];
    let needsSync = false;
    let firstSyncedAt: string | null = null;

    for (const cid of clientIds) {
      const clientName = clientMap.get(cid) ?? cid;
      const campaigns = campaignsByClient.get(cid) ?? [];
      const lastSynced = syncMap.get(cid) ?? null;
      if (!firstSyncedAt && lastSynced) firstSyncedAt = lastSynced;

      if (!campaigns.length) continue;

      const campaignIds = campaigns.map(c => c.campaignId);

      const { count: sentCount } = await db
        .from("lemlist_leads_synced")
        .select("id", { count: "exact", head: true })
        .eq("client_id", cid)
        .in("campaign_id", campaignIds);

      let activitiesQuery = db
        .from("lemlist_activities")
        .select("type, lead_email, lead_first_name, lead_last_name, lead_company_name, created_at")
        .eq("client_id", cid)
        .in("campaign_id", campaignIds)
        .order("created_at", { ascending: false })
        .limit(50000);

      if (since) activitiesQuery = activitiesQuery.gte("created_at", since);

      const { data: activities } = await activitiesQuery;

      if (!lastSynced && (!sentCount || sentCount === 0) && (!activities || activities.length === 0)) {
        needsSync = true;
      }

      function countUnique(type: string) {
        const emails = new Set<string>();
        for (const a of activities ?? []) {
          if (a.type === type && a.lead_email) emails.add(a.lead_email.toLowerCase());
        }
        return emails.size;
      }

      const opened   = countUnique("emailsOpened");
      const clicked  = countUnique("emailsClicked");
      const emailR   = countUnique("emailsReplied");
      const liR      = countUnique("linkedinReplied");
      const liA      = countUnique("linkedinInviteAccepted");
      const bounced  = countUnique("emailsBounced");
      const sent     = sentCount ?? 0;
      const replied  = emailR + liR;

      totalSent             += sent;
      totalOpened           += opened;
      totalReplied          += replied;
      totalEmailReplied     += emailR;
      totalLinkedinReplied  += liR;
      totalLinkedinAccepted += liA;
      totalBounced          += bounced;

      const campName = campaigns.length === 1
        ? (campaigns[0].campaignName ?? campaigns[0].campaignId)
        : `${campaigns.length} campañas`;

      perClient.push({
        clientId: cid,
        clientName,
        campaignName: campName,
        campaignId: campaigns[0]?.campaignId ?? "",
        sent,
        opened,
        openRate:        sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
        clicked,
        replied,
        replyRate:       sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
        emailReplied:    emailR,
        linkedinReplied: liR,
        linkedinAccepted: liA,
        bounced,
        bounceRate:      sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
      });

      // Enriquecer con datos de contacts de Supabase
      const emailsInActivities = [...new Set(
        (activities ?? []).map((a: any) => a.lead_email).filter(Boolean).map((e: string) => e.toLowerCase())
      )];
      const contactMap = new Map<string, { firstName: string; lastName: string; companyName: string }>();
      if (emailsInActivities.length > 0) {
        const { data: supaContacts } = await db
          .from("contacts")
          .select("email, first_name, last_name, companies(company_name)")
          .in("email", emailsInActivities);
        for (const c of supaContacts ?? []) {
          contactMap.set((c.email ?? "").toLowerCase(), {
            firstName:   c.first_name ?? "",
            lastName:    c.last_name  ?? "",
            companyName: (c.companies as any)?.company_name ?? "",
          });
        }
      }

      const leads = buildLeadsFromActivities(activities ?? [], contactMap);
      allLeadsWithActivities.push(...leads);
    }

    if (needsSync && perClient.length === 0) {
      return NextResponse.json({
        _needsSync: true,
        _lastSyncedAt: null,
        totalSent: 0, totalOpened: 0, openRate: 0, totalReplied: 0, replyRate: 0,
        totalEmailReplied: 0, totalLinkedinReplied: 0, totalLinkedinAccepted: 0,
        totalBounced: 0, bounceRate: 0, perClient: [],
        topContacts: [], topCompanies: [], weeklyTrend: [], recentActivity: [],
      } as LemlistReportData);
    }

    const primaryClient = perClient[0];
    const eng = computeEngagement(allLeadsWithActivities, primaryClient?.clientName ?? "");

    const coMerge = new Map<string, CompanyEngagement>();
    for (const co of eng.topCompanies) {
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
      campaignName: perClient.length === 1 ? perClient[0].campaignName : undefined,
      perClient,
      topContacts: eng.contacts,
      topCompanies: Array.from(coMerge.values()).sort((a, b) => b.totalScore - a.totalScore).slice(0, 10),
      weeklyTrend: eng.weeklyTrend,
      recentActivity: eng.recentActivity,
      _lastSyncedAt: firstSyncedAt,
    };

    await db.from("lemlist_report_cache").upsert(
      { client_id: clientId, period: cacheKey, data: payload, fetched_at: new Date().toISOString() },
      { onConflict: "client_id,period" }
    );

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("[reporteria/lemlist]", e);
    return NextResponse.json({ error: e?.message ?? "Error interno" }, { status: 500 });
  }
}
