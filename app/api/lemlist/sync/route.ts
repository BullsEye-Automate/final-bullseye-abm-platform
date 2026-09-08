import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTIVITY_TYPES = [
  "emailsOpened",
  "emailsClicked",
  "emailsReplied",
  "linkedinReplied",
  "linkedinInviteAccepted",
  "emailsBounced",
] as const;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchAllLeads(campaignId: string, headers: Record<string, string>) {
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
    const items: any[] = Array.isArray(data) ? data : (data?.items ?? []);
    all.push(...items);
    if (items.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break;
  }
  return all;
}

async function fetchActivities(type: string, campaignId: string, headers: Record<string, string>) {
  const res = await fetch(
    `https://api.lemlist.com/api/activities?type=${type}&campaignId=${campaignId}&limit=500`,
    { headers }
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : (data?.data ?? data?.activities ?? data?.items ?? []);
}

export async function POST(req: NextRequest) {
  const { client_id } = await req.json().catch(() => ({}));
  if (!client_id) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, client_id);
  if (!apiKey) return NextResponse.json({ error: "Sin API key de Lemlist" }, { status: 400 });

  const { data: assigned } = await db
    .from("client_lemlist_campaigns")
    .select("campaign_id, campaign_name")
    .eq("client_id", client_id)
    .eq("is_active", true);

  if (!assigned?.length) return NextResponse.json({ error: "Sin campañas asignadas" }, { status: 400 });

  const creds = Buffer.from(`:${apiKey}`).toString("base64");
  const headers = { Authorization: `Basic ${creds}` };

  let totalLeads = 0;
  let totalActivities = 0;

  for (const camp of assigned) {
    // 1. Sincronizar leads
    const leads = await fetchAllLeads(camp.campaign_id, headers);
    if (leads.length > 0) {
      const rows = leads.map((l: any) => ({
        id:            l._id,
        client_id,
        campaign_id:   camp.campaign_id,
        campaign_name: camp.campaign_name ?? null,
      }));
      const { error } = await db
        .from("lemlist_leads_synced")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (!error) totalLeads += rows.length;
    }

    // 2. Sincronizar actividades (de a 2 tipos con pausa)
    for (let i = 0; i < ACTIVITY_TYPES.length; i += 2) {
      const pair = ACTIVITY_TYPES.slice(i, i + 2) as string[];
      const results = await Promise.all(pair.map(t => fetchActivities(t, camp.campaign_id, headers)));

      for (let j = 0; j < pair.length; j++) {
        const acts = results[j];
        if (!acts.length) continue;

        const rows = acts.map((a: any) => ({
          id:               a._id,
          client_id,
          campaign_id:      camp.campaign_id,
          campaign_name:    camp.campaign_name ?? null,
          type:             pair[j],
          lead_email:       (a.leadEmail ?? a.email ?? "").toLowerCase() || null,
          lead_first_name:  a.leadFirstName ?? a.firstName ?? null,
          lead_last_name:   a.leadLastName  ?? a.lastName  ?? null,
          lead_company_name: a.leadCompanyName ?? a.companyName ?? null,
          created_at:       a.createdAt ?? a.date ?? null,
        }));

        const { error } = await db
          .from("lemlist_activities")
          .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        if (!error) totalActivities += rows.length;
      }

      if (i + 2 < ACTIVITY_TYPES.length) await sleep(200);
    }

    await sleep(100); // pausa entre campañas
  }

  // Actualizar log de sincronización
  await db.from("lemlist_sync_log").upsert({
    client_id,
    last_synced_at:   new Date().toISOString(),
    leads_count:      totalLeads,
    activities_count: totalActivities,
  }, { onConflict: "client_id" });

  // Invalidar caché de reportería para que tome los datos nuevos
  await db.from("lemlist_report_cache").delete().eq("client_id", client_id);

  return NextResponse.json({
    ok: true,
    campaigns: assigned.length,
    totalLeads,
    totalActivities,
  });
}

// GET — estado de última sincronización
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data } = await db
    .from("lemlist_sync_log")
    .select("*")
    .eq("client_id", clientId)
    .single();

  return NextResponse.json(data ?? { last_synced_at: null });
}
