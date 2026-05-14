import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { deriveOutreachState, type OutreachState } from "@/lib/lemlistActivities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/lemlist/outreach?channel=all|linkedin|email&state=all|replied|connected|interested|bounced|no_response|in_progress
//
// Devuelve los contactos que están en campaña de Lemlist con el estado
// derivado de su cadencia multicanal (a partir de lemlist_activities, que
// llena POST /api/lemlist/sync-activities) + KPIs globales.

type ContactRow = {
  id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  fit_score: number | null;
  lemlist_pushed_at: string | null;
  lemlist_push_error: string | null;
  hubspot_contact_id: string | null;
};

type ActivityRow = {
  contact_id: string | null;
  type: string;
  channel: string | null;
  activity_at: string | null;
};

export async function GET(req: NextRequest) {
  const db = supabaseAdmin();
  const channel = req.nextUrl.searchParams.get("channel") ?? "all";
  const state = req.nextUrl.searchParams.get("state") ?? "all";

  const { data: contactsRaw, error: cErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, email, linkedin_url, " +
        "fit_score, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id"
    )
    .not("lemlist_pushed_at", "is", null)
    .order("lemlist_pushed_at", { ascending: false });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const contacts = (contactsRaw ?? []) as unknown as ContactRow[];

  // Nombres de empresa
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))] as string[];
  const companyName = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await db
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds);
    for (const co of companies ?? []) {
      companyName.set(co.id as string, (co.company_name as string) ?? "");
    }
  }

  // Actividades de Lemlist matcheadas a contactos
  const actsByContact = new Map<string, ActivityRow[]>();
  let lastSyncAt: string | null = null;
  if (contacts.length > 0) {
    const { data: acts, error: aErr } = await db
      .from("lemlist_activities")
      .select("contact_id, type, channel, activity_at")
      .not("contact_id", "is", null);
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    for (const a of (acts ?? []) as unknown as ActivityRow[]) {
      if (!a.contact_id) continue;
      const list = actsByContact.get(a.contact_id) ?? [];
      list.push(a);
      actsByContact.set(a.contact_id, list);
    }
    const { data: lastRow } = await db
      .from("lemlist_activities")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncAt = (lastRow?.created_at as string) ?? null;
  }

  const enriched = contacts.map((c) => {
    const acts = actsByContact.get(c.id) ?? [];
    const st = deriveOutreachState(acts);
    return {
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      job_title: c.job_title,
      email: c.email,
      linkedin_url: c.linkedin_url,
      company_name: c.company_id ? companyName.get(c.company_id) ?? null : null,
      fit_score: c.fit_score,
      lemlist_pushed_at: c.lemlist_pushed_at,
      lemlist_push_error: c.lemlist_push_error,
      hubspot_contact_id: c.hubspot_contact_id,
      state: st
    };
  });

  // KPIs sobre TODOS los contactos en campaña (no filtrados)
  const total = enriched.length;
  const kpis = {
    total,
    replied: enriched.filter((e) => e.state.replied).length,
    connected: enriched.filter(
      (e) => e.state.linkedin_step === "connected" || e.state.linkedin_step === "replied"
    ).length,
    interested: enriched.filter((e) => e.state.interested).length,
    bounced: enriched.filter((e) => e.state.bounced).length,
    linkedin_engaged: enriched.filter((e) => e.state.linkedin_step !== "not_started").length,
    emailed: enriched.filter((e) => e.state.email_step !== "not_started").length,
    no_response: enriched.filter((e) => !e.state.replied).length,
    no_activity: enriched.filter((e) => e.state.activity_count === 0).length
  };

  // Filtros
  const matchesChannel = (s: OutreachState) => {
    if (channel === "linkedin") return s.linkedin_step !== "not_started";
    if (channel === "email") return s.email_step !== "not_started";
    return true;
  };
  const matchesState = (s: OutreachState) => {
    switch (state) {
      case "replied":
        return s.replied;
      case "connected":
        return s.linkedin_step === "connected" || s.linkedin_step === "replied";
      case "interested":
        return s.interested;
      case "bounced":
        return s.bounced;
      case "no_response":
        return !s.replied;
      case "in_progress":
        return s.activity_count > 0 && !s.replied && !s.bounced && !s.unsubscribed;
      default:
        return true;
    }
  };

  const filtered = enriched.filter((e) => matchesChannel(e.state) && matchesState(e.state));

  return NextResponse.json({
    kpis,
    last_sync_at: lastSyncAt,
    channel,
    state,
    contacts: filtered
  });
}
