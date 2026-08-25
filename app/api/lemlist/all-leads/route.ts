import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import {
  getAllCampaignsLeads,
  getAllCampaignsStats,
  getAllCampaignsActivities,
  LEMLIST_ACTIVITY_TYPES,
  type LemlistLeadWithCampaign,
} from "@/lib/lemlist";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Reporte de todos los contactos que entraron a CUALQUIER campaña de Lemlist
// del workspace del cliente (no solo la campaña principal configurada),
// filtrado por fecha de ingreso. Ver lib/lemlist.ts: getAllCampaignsLeads.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId || clientId === "__all__") {
    return NextResponse.json(
      { error: "Selecciona un cliente específico (este reporte no soporta \"todos los clientes\")" },
      { status: 400 }
    );
  }

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "";
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) {
    return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 400 });
  }

  try {
    const { campaigns, leads } = await getAllCampaignsLeads(apiKey);

    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const inRange = leads.filter((l) => {
      if (!l.added_at) return false;
      const t = new Date(l.added_at).getTime();
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    });

    const uniqueContacts = new Set(inRange.map((l) => l.contact_id ?? l.email ?? l.id));
    const uniqueCompanies = new Set(
      inRange.map((l) => l.company_name).filter(Boolean).map((c) => c.trim().toLowerCase())
    );
    const campaignIdsWithActivity = Array.from(new Set(inRange.map((l) => l.campaign_id)));
    const campaignsWithActivity = campaigns.filter((c) => campaignIdsWithActivity.includes(c.id));

    // Stats de engagement: acumulado histórico por campaña (Lemlist no permite
    // filtrarlos por fecha vía esta API) — limitado a las campañas con
    // contactos en el rango elegido, no todo el workspace.
    const campaignStats = await getAllCampaignsStats(campaignsWithActivity, apiKey);
    const totals = campaignStats.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        contacted: acc.contacted + s.contacted,
        opened: acc.opened + s.opened,
        clicked: acc.clicked + s.clicked,
        replied: acc.replied + s.replied,
        bounced: acc.bounced + s.bounced,
        unsubscribed: acc.unsubscribed + s.unsubscribed,
      }),
      { total: 0, contacted: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0 }
    );

    const activities = await getAllCampaignsActivities(campaignsWithActivity, apiKey);
    const linkedinAcceptedContacts = new Set(
      activities.filter((a) => a.type === "linkedinInviteAccepted").map((a) => a.email)
    );

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    const engagement = {
      mensajes_enviados: totals.contacted,
      tasa_apertura: pct(totals.opened, totals.contacted),
      tasa_respuesta: pct(totals.replied, totals.contacted),
      tasa_rebote: pct(totals.bounced, totals.contacted),
      linkedin_aceptadas: linkedinAcceptedContacts.size,
      tasa_aceptacion_linkedin: pct(linkedinAcceptedContacts.size, totals.contacted),
    };

    // Agregación por contacto: puntaje de interacción + descripción de sus
    // actividades, para "Contactos con mayor interacción".
    const leadByEmail = new Map<string, LemlistLeadWithCampaign[]>();
    for (const l of leads) {
      if (!l.email) continue;
      const key = l.email.toLowerCase();
      const arr = leadByEmail.get(key) ?? [];
      arr.push(l);
      leadByEmail.set(key, arr);
    }

    type AggActivity = { type: string; label: string; count: number; lastAt: string | null };
    type ContactAgg = {
      email: string;
      score: number;
      activityMap: Map<string, AggActivity>;
      campaignIds: Set<string>;
    };
    const byContact = new Map<string, ContactAgg>();
    for (const a of activities) {
      const entry = byContact.get(a.email) ?? { email: a.email, score: 0, activityMap: new Map(), campaignIds: new Set() };
      entry.score += a.score;
      entry.campaignIds.add(a.campaignId);
      const existing = entry.activityMap.get(a.type);
      if (existing) {
        existing.count += 1;
        if (a.createdAt && (!existing.lastAt || a.createdAt > existing.lastAt)) existing.lastAt = a.createdAt;
      } else {
        entry.activityMap.set(a.type, {
          type: a.type,
          label: LEMLIST_ACTIVITY_TYPES.find((t) => t.type === a.type)?.label ?? a.type,
          count: 1,
          lastAt: a.createdAt,
        });
      }
      byContact.set(a.email, entry);
    }

    const topContacts = Array.from(byContact.values())
      .map((agg) => {
        const matches = leadByEmail.get(agg.email) ?? [];
        const inCampaignMatches = matches.filter((m) => agg.campaignIds.has(m.campaign_id));
        const best = inCampaignMatches[0] ?? matches[0] ?? null;
        const campaignNames = Array.from(
          new Set((inCampaignMatches.length > 0 ? inCampaignMatches : matches.slice(0, 1)).map((m) => m.campaign_name))
        );
        const activityList = Array.from(agg.activityMap.values()).sort((a, b) => b.count - a.count);
        return {
          email: agg.email,
          first_name: best?.first_name ?? "",
          last_name: best?.last_name ?? "",
          company_name: best?.company_name ?? "",
          job_title: best?.job_title ?? "",
          campaign_names: campaignNames,
          score: agg.score,
          total_interactions: activityList.reduce((s, x) => s + x.count, 0),
          activities: activityList,
        };
      })
      .filter((c) => c.total_interactions > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    return NextResponse.json({
      range: { key, start: range.start, end: range.end, label: range.label },
      campaigns,
      leads: inRange,
      stats: {
        contactos: uniqueContacts.size,
        empresas: uniqueCompanies.size,
        campanas_con_actividad: campaignsWithActivity.length,
        campanas_total: campaigns.length,
      },
      engagement,
      top_contacts: topContacts,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Lemlist" }, { status: 500 });
  }
}
