import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";
import {
  searchHSContactByBullseyeId,
  searchHSContact,
  upsertHSContact,
  searchHSCompany,
  upsertHSCompany,
  associateContactCompany,
  patchHSContact,
  matchClientOption,
  computeEngagementScore,
} from "@/lib/hubspot";
import { generateSdrScript } from "@/lib/sdrScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function fetchAllLeads(campaignId: string, credentials: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items: any[] = data?.items ?? (Array.isArray(data) ? data : []);
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function GET(req: NextRequest) {
  // Vercel envía el header Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  // Traer todos los clientes activos con campaña de Lemlist configurada
  const { data: configs } = await db
    .from("client_configs")
    .select("client_id, lemlist_campaign_id, hubspot_owner_id")
    .not("lemlist_campaign_id", "is", null);

  if (!configs?.length) return NextResponse.json({ message: "Sin clientes configurados", results: [] });

  const summary: { client_id: string; updated: number; synced: number; error?: string }[] = [];

  for (const config of configs) {
    try {
      const { updated, synced } = await refreshClientContacts(db, config, credentials, apiKey);
      summary.push({ client_id: config.client_id, updated, synced });
    } catch (err: any) {
      summary.push({ client_id: config.client_id, updated: 0, synced: 0, error: err?.message ?? "error" });
    }
  }

  return NextResponse.json({ ok: true, summary });
}

async function refreshClientContacts(
  db: ReturnType<typeof import("@/lib/supabase").supabaseAdmin>,
  config: { client_id: string; lemlist_campaign_id: string; hubspot_owner_id?: string | null },
  credentials: string,
  apiKey: string
): Promise<{ updated: number; synced: number }> {
  const leads = await fetchAllLeads(config.lemlist_campaign_id, credentials);
  if (leads.length === 0) return { updated: 0, synced: 0 };

  const leadByEmail    = new Map<string, any>();
  const leadByLinkedin = new Map<string, any>();
  for (const lead of leads) {
    if (lead.email?.trim()) leadByEmail.set(lead.email.trim().toLowerCase(), lead);
    if (lead.linkedinUrl?.trim()) {
      const norm = normalizeLinkedInUrl(lead.linkedinUrl);
      if (norm) leadByLinkedin.set(norm.toLowerCase(), lead);
    }
  }

  const { data: contacts } = await db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, email, phone, phone_source, linkedin_url, company_id, email_subject, email_body, linkedin_icebreaker, seniority, fit_score, status")
    .eq("client_id", config.client_id)
    .not("lemlist_pushed_at", "is", null);

  if (!contacts?.length) return { updated: 0, synced: 0 };

  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies").select("id, company_name, fit_signals").in("id", companyIds);
  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const { data: client } = await db.from("clients").select("name").eq("id", config.client_id).maybeSingle();

  let trainingConfig: Record<string, string | null> = {};
  try {
    const { data: tc } = await db
      .from("model_training_config")
      .select("business_description, value_props, talking_points")
      .eq("client_id", config.client_id).maybeSingle();
    trainingConfig = tc ?? {};
  } catch { /* tabla puede no existir */ }

  const { data: icpCtx } = await db
    .from("client_ai_context").select("content")
    .eq("client_id", config.client_id).eq("file_type", "icp")
    .order("uploaded_at", { ascending: false }).limit(1).maybeSingle();

  const icpContext = [
    icpCtx?.content,
    trainingConfig.business_description && `Descripción del negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuestas de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave: ${trainingConfig.talking_points}`,
  ].filter(Boolean).join("\n\n") || undefined;

  const trainingCtxForScript = [
    trainingConfig.business_description && `Negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuesta de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave: ${trainingConfig.talking_points}`,
  ].filter(Boolean).join("\n") || null;

  const clientLabel = client?.name ? await matchClientOption(client.name) : null;

  let updated = 0, synced = 0;

  for (const contact of contacts) {
    const normLinkedin = contact.linkedin_url ? (normalizeLinkedInUrl(contact.linkedin_url) ?? "").toLowerCase() : "";
    const lead =
      (contact.email ? leadByEmail.get(contact.email.toLowerCase()) : null) ??
      (normLinkedin  ? leadByLinkedin.get(normLinkedin)              : null);

    if (!lead) continue;

    const gotNewEmail = !contact.email?.trim() && !!lead.email?.trim();
    const gotNewPhone = !contact.phone?.trim()  && !!lead.phone?.trim();

    if (gotNewEmail || gotNewPhone) {
      const update: Record<string, string> = {};
      if (gotNewEmail) update.email = lead.email.trim();
      if (gotNewPhone) { update.phone = lead.phone.trim(); update.phone_source = "lemlist"; }
      await db.from("contacts").update(update).eq("id", contact.id);
      Object.assign(contact, update);
      updated++;
    }

    const company     = companyById.get(contact.company_id);
    const companyName = company?.company_name ?? "";
    const fitSignals  = company?.fit_signals  ?? null;
    const isLushaPhone  = contact.phone_source === "lusha";
    const standardPhone = !isLushaPhone ? (contact.phone ?? null) : null;
    const lushaPhone    = isLushaPhone  ? (contact.phone ?? null) : null;
    const engagementScore = computeEngagementScore({ emailSent: true, hasRecentActivity: true });

    let hsCompanyId: string | null = null;
    if (companyName) {
      const existingCompanyId = await searchHSCompany(companyName);
      hsCompanyId = await upsertHSCompany(
        { name: companyName, bullseye_fit_signals: fitSignals || undefined, bullseye_company_id: contact.company_id || undefined,
          cliente_bullseye_ia: client?.name || undefined,
          ...(clientLabel ? { cliente_bullseye_empresa: clientLabel } : {}) },
        existingCompanyId
      );
    }

    const existingContactId =
      await searchHSContactByBullseyeId(contact.id) ??
      (contact.email ? await searchHSContact(contact.email) : null);

    const hsContactId = await upsertHSContact({
      email:                        contact.email               ?? undefined,
      firstname:                    contact.first_name          ?? undefined,
      lastname:                     contact.last_name           ?? undefined,
      jobtitle:                     contact.job_title           ?? undefined,
      phone:                        standardPhone               ?? undefined,
      linkedin_bio:                 contact.linkedin_url        ?? undefined,
      bullseye_contact_id:          contact.id,
      bullseye_client_name:         client?.name                ?? undefined,
      cliente_bullseye_ia:          client?.name                ?? undefined,
      bullseye_seniority:           contact.seniority           ?? undefined,
      bullseye_linkedin_headline:   contact.linkedin_headline   ?? undefined,
      bullseye_email_subject:       contact.email_subject       ?? undefined,
      bullseye_email_body:          contact.email_body          ?? undefined,
      bullseye_linkedin_icebreaker: contact.linkedin_icebreaker ?? undefined,
      bullseye_telefono_lusha:      lushaPhone                  ?? undefined,
      bullseye_fit_score:           contact.fit_score           ?? undefined,
      bullseye_engagement_score:    engagementScore,
      bullseye_status:              contact.status              ?? undefined,
      bullseye_lemlist_campaign_id: config.lemlist_campaign_id,
      bullseye_phone_source:        contact.phone_source        ?? undefined,
      ...(config.hubspot_owner_id ? { hubspot_owner_id: config.hubspot_owner_id } : {}),
    }, existingContactId);

    if (hsContactId && hsCompanyId) await associateContactCompany(hsContactId, hsCompanyId);

    if (hsContactId && contact.email) {
      generateSdrScript({
        firstName:   contact.first_name ?? "",
        lastName:    contact.last_name  ?? "",
        jobTitle:    contact.job_title  ?? "",
        companyName, fitSignals,
        icpContext:  icpContext ?? null,
        trainingCtx: trainingCtxForScript,
        emailBody:   contact.email_body          ?? null,
        icebreaker:  contact.linkedin_icebreaker ?? null,
      })
        .then((script) => patchHSContact(hsContactId, { bullseye_script_sdr_ia: script }))
        .catch(() => {});
    }

    synced++;
  }

  return { updated, synced };
}
