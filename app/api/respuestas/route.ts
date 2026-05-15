import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isReplyType } from "@/lib/repliesSync";
import { POSITIVE_REPLY_CATEGORIES, type ReplyCategory } from "@/lib/replyAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/respuestas?channel=all|linkedin|email&category=all|<cat>&status=all|pending|handled
//
// Inbox de respuestas de la cadencia de Lemlist. Lee las actividades de tipo
// reply de lemlist_activities (anotadas por /api/respuestas/sync con el texto
// y la clasificación de Claude), las une a contactos + empresas y devuelve
// la lista + KPIs.

type ActivityRow = {
  id: string;
  contact_id: string | null;
  lead_email: string | null;
  channel: string | null;
  type: string;
  activity_at: string | null;
  reply_text: string | null;
  reply_category: string | null;
  reply_sentiment: string | null;
  reply_summary: string | null;
  reply_suggested_step: string | null;
  reply_analyzed_at: string | null;
  reply_analysis_error: string | null;
  reply_triage: string | null;
  reply_handled_at: string | null;
  reply_sent_text: string | null;
  reply_sent_at: string | null;
  reply_send_error: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_id: string | null;
  fit_score: number | null;
  status: string | null;
  human_decision: string | null;
  hubspot_contact_id: string | null;
};

export async function GET(req: NextRequest) {
  const db = supabaseAdmin();
  const channel = req.nextUrl.searchParams.get("channel") ?? "all";
  const category = req.nextUrl.searchParams.get("category") ?? "all";
  const status = req.nextUrl.searchParams.get("status") ?? "all";

  const { data: rawRows, error } = await db
    .from("lemlist_activities")
    .select(
      "id, contact_id, lead_email, channel, type, activity_at, reply_text, " +
        "reply_category, reply_sentiment, reply_summary, reply_suggested_step, " +
        "reply_analyzed_at, reply_analysis_error, reply_triage, reply_handled_at, " +
        "reply_sent_text, reply_sent_at, reply_send_error"
    )
    .or("type.ilike.%replied%,type.ilike.%answer%,type.ilike.%reply%")
    .order("activity_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((rawRows ?? []) as unknown as ActivityRow[]).filter((r) =>
    isReplyType(String(r.type))
  );

  // Contactos + empresas
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const contactById = new Map<string, ContactRow>();
  const companyName = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: cs } = await db
      .from("contacts")
      .select(
        "id, first_name, last_name, job_title, email, linkedin_url, company_id, " +
          "fit_score, status, human_decision, hubspot_contact_id"
      )
      .in("id", contactIds);
    for (const c of (cs ?? []) as unknown as ContactRow[]) contactById.set(c.id, c);
    const companyIds = [
      ...new Set([...contactById.values()].map((c) => c.company_id).filter(Boolean))
    ] as string[];
    if (companyIds.length > 0) {
      const { data: cos } = await db
        .from("companies")
        .select("id, company_name")
        .in("id", companyIds);
      for (const co of cos ?? []) {
        companyName.set(co.id as string, (co.company_name as string) ?? "");
      }
    }
  }

  const enriched = rows.map((r) => {
    const c = r.contact_id ? contactById.get(r.contact_id) : undefined;
    // Categoría efectiva: el override humano manda sobre la clasificación IA.
    const effective_category = (r.reply_triage || r.reply_category || null) as
      | ReplyCategory
      | null;
    return {
      id: r.id,
      contact_id: r.contact_id,
      channel: r.channel,
      type: r.type,
      activity_at: r.activity_at,
      reply_text: r.reply_text,
      reply_category: r.reply_category,
      reply_sentiment: r.reply_sentiment,
      reply_summary: r.reply_summary,
      reply_suggested_step: r.reply_suggested_step,
      reply_analyzed_at: r.reply_analyzed_at,
      reply_analysis_error: r.reply_analysis_error,
      reply_triage: r.reply_triage,
      reply_handled_at: r.reply_handled_at,
      reply_sent_text: r.reply_sent_text,
      reply_sent_at: r.reply_sent_at,
      reply_send_error: r.reply_send_error,
      effective_category,
      handled: !!r.reply_handled_at,
      contact: c
        ? {
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
            job_title: c.job_title,
            email: c.email,
            linkedin_url: c.linkedin_url,
            company_name: c.company_id ? companyName.get(c.company_id) ?? null : null,
            fit_score: c.fit_score,
            status: c.status,
            human_decision: c.human_decision,
            hubspot_contact_id: c.hubspot_contact_id
          }
        : { name: r.lead_email, email: r.lead_email }
    };
  });

  // KPIs sobre TODAS las respuestas (no filtradas)
  const kpis = {
    total: enriched.length,
    linkedin: enriched.filter((e) => e.channel === "linkedin").length,
    email: enriched.filter((e) => e.channel === "email").length,
    positive: enriched.filter(
      (e) =>
        e.effective_category &&
        POSITIVE_REPLY_CATEGORIES.has(e.effective_category as ReplyCategory)
    ).length,
    needs_attention: enriched.filter((e) => !e.handled).length,
    with_text: enriched.filter((e) => e.reply_text).length,
    analyzed: enriched.filter((e) => e.reply_analyzed_at).length,
    contacts_replied: new Set(enriched.map((e) => e.contact_id).filter(Boolean)).size
  };

  const filtered = enriched.filter((e) => {
    if (channel !== "all" && e.channel !== channel) return false;
    if (category !== "all" && e.effective_category !== category) return false;
    if (status === "pending" && e.handled) return false;
    if (status === "handled" && !e.handled) return false;
    return true;
  });

  return NextResponse.json({ kpis, channel, category, status, replies: filtered });
}
