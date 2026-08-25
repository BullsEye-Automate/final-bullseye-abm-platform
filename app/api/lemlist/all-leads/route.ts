import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import {
  getAllCampaignsLeads,
  getAllCampaignsStats,
  getAllCampaignsActivities,
  getAllCampaignsFunnelEvents,
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

    // Las métricas de engagement (mensajes enviados, tasas de apertura/
    // respuesta/rebote/aceptación LinkedIn) NO se filtran por cuándo entró
    // el contacto a la campaña — se filtran por cuándo ocurrió cada evento
    // (envío, apertura, respuesta, etc.), igual que el propio dashboard de
    // Lemlist. Por eso una campaña sin contactos NUEVOS este mes puede
    // seguir mostrando actividad: son secuencias en curso sobre contactos
    // que entraron antes.
    //
    // Stats por campaña (histórico, solo para descartar campañas que nunca
    // tuvieron contactos y no vale la pena escanear).
    const campaignStats = await getAllCampaignsStats(campaigns, apiKey);
    const statsById = new Map(campaignStats.map((s) => [s.id, s]));
    const campaignsToScan = campaigns.filter((c) => {
      const s = statsById.get(c.id);
      return !s || s.total > 0;
    });

    const [activities, funnelEvents] = await Promise.all([
      getAllCampaignsActivities(campaignsToScan, apiKey, startMs),
      getAllCampaignsFunnelEvents(campaignsToScan, apiKey, startMs),
    ]);

    const inDateRange = (iso: string | null) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    };
    const activitiesInRange = activities.filter((a) => inDateRange(a.createdAt));
    const funnelInRange = funnelEvents.filter((e) => inDateRange(e.createdAt));

    const uniqueEmails = (items: { email: string }[]) => new Set(items.map((i) => i.email)).size;

    const contacted = uniqueEmails(funnelInRange.filter((e) => e.type === "emailsSent"));
    const bounced = uniqueEmails(funnelInRange.filter((e) => e.type === "emailsBounced"));
    const linkedinInvited = uniqueEmails(funnelInRange.filter((e) => e.type === "linkedinInviteSent"));
    const opened = uniqueEmails(activitiesInRange.filter((a) => a.type === "emailsOpened"));
    const replied = uniqueEmails(activitiesInRange.filter((a) => a.type === "emailsReplied" || a.type === "linkedinReplied"));
    const linkedinAccepted = uniqueEmails(activitiesInRange.filter((a) => a.type === "linkedinInviteAccepted"));

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    const engagement = {
      mensajes_enviados: contacted,
      tasa_apertura: pct(opened, contacted),
      tasa_respuesta: pct(replied, contacted),
      tasa_rebote: pct(bounced, contacted),
      linkedin_aceptadas: linkedinAccepted,
      tasa_aceptacion_linkedin: pct(linkedinAccepted, linkedinInvited || contacted),
    };

    // "Campañas con actividad" = entraron contactos nuevos O hubo algún
    // evento de engagement en el rango — no solo lo primero.
    const campaignIdsWithActivity = new Set([
      ...inRange.map((l) => l.campaign_id),
      ...activitiesInRange.map((a) => a.campaignId),
      ...funnelInRange.map((e) => e.campaignId),
    ]);
    const campaignsWithActivity = campaigns.filter((c) => campaignIdsWithActivity.has(c.id));

    // Agregación por contacto: puntaje de interacción + descripción de sus
    // actividades (solo dentro del rango elegido), para "Contactos con
    // mayor interacción".
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
    for (const a of activitiesInRange) {
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
