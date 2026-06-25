import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVITY_TYPES = [
  { type: "emailsReplied",          score: 10, label: "Respondió email",        color: "#22c55e" },
  { type: "linkedinReplied",        score: 10, label: "Respondió en LinkedIn",  color: "#0a66c2" },
  { type: "linkedinInviteAccepted", score: 7,  label: "Aceptó conexión",        color: "#6366f1" },
  { type: "emailsClicked",          score: 5,  label: "Hizo clic en email",     color: "#f59e0b" },
  { type: "linkedinVisited",        score: 3,  label: "Visitó perfil LinkedIn", color: "#8b5cf6" },
  { type: "emailsOpened",           score: 2,  label: "Abrió email",            color: "#3b82f6" },
];

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const limit    = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "150", 10), 500);

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id, hubspot_portal_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña de Lemlist configurada para este cliente" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  const credentials   = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId    = config.lemlist_campaign_id;
  const hubspotPortalId = (config as any).hubspot_portal_id ?? process.env.HUBSPOT_PORTAL_ID ?? null;

  const fetches = await Promise.allSettled(
    ACTIVITY_TYPES.map(async ({ type, score, label, color }) => {
      try {
        const res = await fetch(
          `https://api.lemlist.com/api/activities?type=${type}&campaignId=${campaignId}&limit=${limit}`,
          { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
        );
        if (!res.ok) return [];
        const data   = await res.json();
        const items: any[] = Array.isArray(data) ? data : (data.data ?? data.activities ?? []);
        return items
          .map(a => ({
            type, score, label, color,
            email:            (a.email ?? a.leadEmail ?? "").trim().toLowerCase(),
            createdAt:        a.createdAt ?? a.date ?? null,
            activityId:       a._id ?? a.id ?? null,
            firstName:        a.firstName ?? null,
            lastName:         a.lastName  ?? null,
            text:             a.text ?? a.body ?? null,
            campaignStepName: a.campaignStepName ?? a.stepName ?? null,
            subject:          a.emailSubject ?? a.subject ?? null,
            stepIndex:        a.stepIndex ?? null,
            companyName:      a.companyName ?? a.company ?? a.organizationName ?? null,
            companyDomain:    a.companyDomain ?? null,
            phone:            a.phone ?? a.phoneNumber ?? null,
            linkedinUrl:      a.linkedinUrl ?? a.linkedin ?? null,
          }))
          .filter(a => a.email);
      } catch {
        return [];
      }
    })
  );

  type AggEntry = {
    totalScore:   number;
    activities:   any[];
    firstName?:   string;
    lastName?:    string;
    companyName?: string;
    phone?:       string;
    linkedinUrl?: string;
    jobTitle?:    string;
  };

  const byEmail = new Map<string, AggEntry>();

  for (const result of fetches) {
    if (result.status !== "fulfilled") continue;
    for (const act of result.value) {
      const entry = byEmail.get(act.email) ?? { totalScore: 0, activities: [] };
      entry.totalScore += act.score;
      entry.activities.push({
        type: act.type, score: act.score, label: act.label, color: act.color,
        createdAt: act.createdAt, activityId: act.activityId, text: act.text,
        campaignStepName: act.campaignStepName, subject: act.subject, stepIndex: act.stepIndex,
      });
      if (!entry.firstName   && act.firstName)   entry.firstName   = act.firstName;
      if (!entry.lastName    && act.lastName)     entry.lastName    = act.lastName;
      if (!entry.companyName && act.companyName)  entry.companyName = act.companyName;
      if (!entry.phone       && act.phone)        entry.phone       = act.phone;
      if (!entry.linkedinUrl && act.linkedinUrl)  entry.linkedinUrl = act.linkedinUrl;
      byEmail.set(act.email, entry);
    }
  }

  if (byEmail.size === 0) {
    return NextResponse.json({ contacts: [], hubspot_portal_id: hubspotPortalId });
  }

  const emails = Array.from(byEmail.keys());

  // Buscar contactos — primero con client_id, luego cross-client como fallback
  const { data: contactsForClient } = await db
    .from("contacts")
    .select(`id, email, first_name, last_name, job_title, phone, phone_clay, hubspot_contact_id, company_id,
             email_subject, email_body, email_subject_2, email_body_2, email_subject_3, email_body_3,
             linkedin_icebreaker, connect_message, linkedin_msg_2, lemlist_pushed_at, status, linkedin_url`)
    .eq("client_id", clientId)
    .in("email", emails);

  const foundEmails = new Set((contactsForClient ?? []).map(c => c.email?.toLowerCase()));
  const missingEmails = emails.filter(e => !foundEmails.has(e));

  let contactsFallback: any[] = [];
  if (missingEmails.length > 0) {
    const { data } = await db
      .from("contacts")
      .select(`id, email, first_name, last_name, job_title, phone, phone_clay, hubspot_contact_id, company_id,
               email_subject, email_body, email_subject_2, email_body_2, email_subject_3, email_body_3,
               linkedin_icebreaker, connect_message, linkedin_msg_2, lemlist_pushed_at, status, linkedin_url`)
      .in("email", missingEmails);
    contactsFallback = data ?? [];
  }

  const allContacts = [...(contactsForClient ?? []), ...contactsFallback];
  const contactByEmail = new Map(allContacts.map(c => [c.email?.toLowerCase(), c]));

  // Enriquecer desde Lemlist leads para emails aún sin empresa
  try {
    const leadsRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    );
    if (leadsRes.ok) {
      const leadsData = await leadsRes.json();
      const leadsList: any[] = Array.isArray(leadsData) ? leadsData : (leadsData.leads ?? []);
      for (const lead of leadsList) {
        const leadEmail = (lead.email ?? lead._id ?? "").toLowerCase();
        if (!byEmail.has(leadEmail)) continue;
        const entry = byEmail.get(leadEmail)!;
        if (!entry.companyName && (lead.companyName ?? lead.company ?? lead.organizationName)) {
          entry.companyName = lead.companyName ?? lead.company ?? lead.organizationName;
        }
        if (!entry.phone && (lead.phone ?? lead.phoneNumber)) {
          entry.phone = lead.phone ?? lead.phoneNumber;
        }
        if (!entry.linkedinUrl && lead.linkedinUrl) entry.linkedinUrl = lead.linkedinUrl;
        if (!entry.firstName   && lead.firstName)   entry.firstName   = lead.firstName;
        if (!entry.lastName    && lead.lastName)     entry.lastName    = lead.lastName;
        if (!entry.jobTitle    && (lead.jobTitle ?? lead.title)) entry.jobTitle = lead.jobTitle ?? lead.title;
      }
    }
  } catch {
    // best-effort
  }

  const companyIds = [...new Set(allContacts.map(c => c.company_id).filter(Boolean) as string[])];
  let companyById  = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await db.from("companies").select("id, company_name").in("id", companyIds);
    companyById = new Map((companies ?? []).map(c => [c.id, c.company_name]));
  }

  const contactIds = allContacts.map(c => c.id).filter(Boolean) as string[];
  let labelByContactId = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: labels } = await db.from("contact_sdr_labels").select("contact_id, label").in("contact_id", contactIds);
    labelByContactId = new Map((labels ?? []).map(l => [l.contact_id, l.label]));
  }

  let labelByEmail = new Map<string, string>();
  {
    const { data: emailLabels } = await db
      .from("contact_sdr_labels").select("email, label")
      .eq("client_id", clientId).in("email", emails).is("contact_id", null);
    if (emailLabels) labelByEmail = new Map(emailLabels.map(l => [l.email, l.label]));
  }

  const result = emails
    .map(email => {
      const agg     = byEmail.get(email)!;
      const contact = contactByEmail.get(email);
      const company = contact ? companyById.get(contact.company_id ?? "") : null;
      const activities = agg.activities.sort((a, b) => (b.createdAt ?? "") > (a.createdAt ?? "") ? 1 : -1);
      const sdrLabel = contact ? (labelByContactId.get(contact.id) ?? null) : (labelByEmail.get(email) ?? null);

      return {
        email,
        contact_id:         contact?.id ?? null,
        first_name:         contact?.first_name ?? agg.firstName ?? null,
        last_name:          contact?.last_name  ?? agg.lastName  ?? null,
        job_title:          contact?.job_title  ?? agg.jobTitle ?? null,
        company_name:       company ?? agg.companyName ?? null,
        phone:              contact?.phone ?? contact?.phone_clay ?? agg.phone ?? null,
        linkedin_url:       contact?.linkedin_url ?? agg.linkedinUrl ?? null,
        hubspot_contact_id: contact?.hubspot_contact_id ?? null,
        total_score:        agg.totalScore,
        activities,
        messages: contact ? {
          email1:           { subject: contact.email_subject,   body: contact.email_body   },
          email2:           { subject: contact.email_subject_2, body: contact.email_body_2 },
          email3:           { subject: contact.email_subject_3, body: contact.email_body_3 },
          linkedin_connect: contact.connect_message,
          linkedin_msg1:    contact.linkedin_icebreaker,
          linkedin_msg2:    contact.linkedin_msg_2,
        } : null,
        sdr_label:          sdrLabel,
        status:             contact?.status ?? null,
        lemlist_pushed_at:  contact?.lemlist_pushed_at ?? null,
      };
    })
    .filter(c => c.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score);

  return NextResponse.json({ contacts: result, hubspot_portal_id: hubspotPortalId });
}
