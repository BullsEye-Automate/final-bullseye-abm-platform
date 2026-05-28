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
  computeEngagementScore,
} from "@/lib/hubspot";
import { generateSdrScript } from "@/lib/sdrScript";
import { generateContactMessages } from "@/lib/messageGenerator";

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
): Promise<{ updated: number; synced: number; generated: number }> {
  const leads = await fetchAllLeads(config.lemlist_campaign_id, credentials);
  if (leads.length === 0) return { updated: 0, synced: 0, generated: 0 };

  const leadByEmail      = new Map<string, any>();
  const leadByLinkedin   = new Map<string, any>();
  const leadByBullseyeId = new Map<string, any>();
  const leadByName       = new Map<string, any>();
  for (const lead of leads) {
    if (lead.email?.trim())             leadByEmail.set(lead.email.trim().toLowerCase(), lead);
    if (lead.bullseyeContactId?.trim()) leadByBullseyeId.set(lead.bullseyeContactId.trim(), lead);
    if (lead.linkedinUrl?.trim()) {
      const norm = normalizeLinkedInUrl(lead.linkedinUrl);
      if (norm) leadByLinkedin.set(norm.toLowerCase(), lead);
    }
    const nameKey = [lead.firstName, lead.lastName, lead.companyName]
      .map((s: string | undefined) => (s ?? "").trim().toLowerCase()).join("|");
    if (nameKey !== "||") leadByName.set(nameKey, lead);
  }

  const { data: contacts } = await db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, email, phone, phone_source, linkedin_url, company_id, email_subject, email_body, linkedin_icebreaker, seniority, fit_score, status")
    .eq("client_id", config.client_id)
    .not("lemlist_pushed_at", "is", null);

  if (!contacts?.length) return { updated: 0, synced: 0, generated: 0 };

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

  let updated = 0, synced = 0, generated = 0;

  for (const contact of contacts) {
    try {
      // 1. Intentar matchear en Lemlist para enriquecer email/phone
      const normLinkedin = contact.linkedin_url ? (normalizeLinkedInUrl(contact.linkedin_url) ?? "").toLowerCase() : "";
      const contactNameKey = [contact.first_name, contact.last_name, companyById.get(contact.company_id)?.company_name]
        .map((s: string | undefined) => (s ?? "").trim().toLowerCase()).join("|");
      const lead =
        leadByBullseyeId.get(contact.id) ??
        (contact.email ? leadByEmail.get(contact.email.toLowerCase()) : null) ??
        (normLinkedin  ? leadByLinkedin.get(normLinkedin)              : null) ??
        (contactNameKey !== "||" ? leadByName.get(contactNameKey)      : null);

      if (lead) {
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
      }

      // 2. Buscar contacto existente en HubSpot
      const existingContactId =
        await searchHSContactByBullseyeId(contact.id) ??
        (contact.email ? await searchHSContact(contact.email) : null);

      // Solo crear nuevo si ya tiene email o teléfono; siempre actualizar si ya existe en HubSpot
      if (!existingContactId && !contact.email?.trim() && !contact.phone?.trim()) continue;

      const company     = companyById.get(contact.company_id);
      const companyName = company?.company_name ?? "";
      const fitSignals  = company?.fit_signals  ?? null;

      // 3. Generar mensajes si faltan
      const needsMessages =
        !contact.email_subject ||
        !contact.email_body    ||
        !contact.linkedin_icebreaker ||
        contact.email_body?.includes("{{firstName}}");

      if (needsMessages) {
        try {
          const enrichedContext = [
            icpContext,
            fitSignals && `Señales de fit de esta empresa: ${fitSignals}`,
          ].filter(Boolean).join("\n\n") || undefined;

          const msgs = await generateContactMessages({
            hasEmail:         !!contact.email?.trim(),
            firstName:        contact.first_name        ?? undefined,
            lastName:         contact.last_name         ?? undefined,
            jobTitle:         contact.job_title         ?? undefined,
            linkedinHeadline: contact.linkedin_headline ?? undefined,
            companyName:      companyName               || undefined,
            icpContext:       enrichedContext,
            language:         "es",
          });

          const msgUpdate: Record<string, string | undefined> = {};
          if (msgs.emailSubject)              msgUpdate.email_subject       = msgs.emailSubject;
          if (msgs.emailBody)                 msgUpdate.email_body          = msgs.emailBody;
          if (msgs.linkedinIcebreaker)        msgUpdate.linkedin_icebreaker = msgs.linkedinIcebreaker;
          if (msgs.linkedinIcebreakerNoEmail) msgUpdate.linkedin_icebreaker = msgs.linkedinIcebreakerNoEmail;

          if (Object.keys(msgUpdate).length > 0) {
            await db.from("contacts").update(msgUpdate).eq("id", contact.id);
            Object.assign(contact, msgUpdate);
            generated++;
          }
        } catch (err: any) {
          console.error(`[refresh-lemlist] error generando mensajes contacto ${contact.id}:`, err?.message);
        }
      }

      const isLushaPhone  = contact.phone_source === "lusha";
      const standardPhone = !isLushaPhone ? (contact.phone ?? null) : null;
      const lushaPhone    = isLushaPhone  ? (contact.phone ?? null) : null;
      const engagementScore = computeEngagementScore({ emailSent: true, hasRecentActivity: true });

      let hsCompanyId: string | null = null;
      if (companyName) {
        const existingCompanyId = await searchHSCompany(companyName);
        hsCompanyId = await upsertHSCompany(
          { name: companyName, bullseye_fit_signals: fitSignals || undefined, bullseye_company_id: contact.company_id || undefined },
          existingCompanyId
        );
      }

      const hsContactId = await upsertHSContact({
        email:                        contact.email               ?? undefined,
        firstname:                    contact.first_name          ?? undefined,
        lastname:                     contact.last_name           ?? undefined,
        jobtitle:                     contact.job_title           ?? undefined,
        phone:                        standardPhone               ?? undefined,
        hs_linkedin_url:              contact.linkedin_url        ?? undefined,
        bullseye_contact_id:          contact.id,
        bullseye_client_name:         client?.name                ?? undefined,
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

      if (!hsContactId) { synced++; continue; }

      if (hsCompanyId) await associateContactCompany(hsContactId, hsCompanyId);

      if (contact.email) {
        try {
          const script = await generateSdrScript({
            firstName:   contact.first_name ?? "",
            lastName:    contact.last_name  ?? "",
            jobTitle:    contact.job_title  ?? "",
            companyName, fitSignals,
            icpContext:  icpContext ?? null,
            trainingCtx: trainingCtxForScript,
            emailBody:   contact.email_body          ?? null,
            icebreaker:  contact.linkedin_icebreaker ?? null,
          });
          const scriptOk = await patchHSContact(hsContactId, { bullseye_script_sdr_ia: script });
          if (!scriptOk) {
            console.error(`[sdr-script] patchHSContact falló para contacto ${contact.id} (hsId=${hsContactId})`);
          }
        } catch (err: any) {
          console.error(`[sdr-script] error generando script para contacto ${contact.id}:`, err?.message);
        }
      }

      synced++;
    } catch (err: any) {
      console.error(`[refresh-lemlist] error contacto ${contact.id}:`, (err as any)?.message);
    }
  }

  return { updated, synced, generated };
}
