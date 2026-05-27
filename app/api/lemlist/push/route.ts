import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";
import { generateSdrScript } from "@/lib/sdrScript";
import {
  matchClientOption,
  computeEngagementScore,
  searchHSCompany,
  upsertHSCompany,
  searchHSContact,
  upsertHSContact,
  associateContactCompany,
  patchHSContact,
} from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { client_id: string; contact_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();

  // ── Cliente y configuración ────────────────────────────────────────────────
  const [{ data: client }, { data: config }] = await Promise.all([
    db.from("clients").select("name").eq("id", body.client_id).maybeSingle(),
    db.from("client_configs")
      .select("lemlist_campaign_id, hubspot_owner_id")
      .eq("client_id", body.client_id)
      .maybeSingle(),
  ]);

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada en Config. cliente" }, { status: 400 });
  }

  // ── ICP del cliente (para contextualizar mensajes) ─────────────────────────
  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", body.client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Configuración de entrenamiento de modelo (tono, propuestas de valor) ───
  let trainingConfig: Record<string, string | null> = {};
  try {
    const { data: tc } = await db
      .from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona")
      .eq("client_id", body.client_id)
      .maybeSingle();
    trainingConfig = tc ?? {};
  } catch { /* tabla puede no existir aún */ }

  // Contexto combinado para Claude
  const icpContext = [
    icpCtx?.content,
    trainingConfig.business_description && `Descripción del negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuestas de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave de conversación: ${trainingConfig.talking_points}`,
    trainingConfig.target_buyer_persona && `Buyer persona: ${trainingConfig.target_buyer_persona}`,
  ].filter(Boolean).join("\n\n") || undefined;

  // ── Contactos a procesar ───────────────────────────────────────────────────
  // Cuando se pasan contact_ids específicos no filtramos por client_id (los IDs
  // ya son suficientemente selectivos y los contactos pueden carecer de client_id
  // si se importaron antes del soporte multi-tenant).
  let q = db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, seniority, email, phone, phone_source, linkedin_url, company_id, email_subject, email_body, linkedin_icebreaker, fit_score")
    .eq("fit_action", "enrich")
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded");

  if (body.contact_ids?.length) {
    q = q.in("id", body.contact_ids);
  } else {
    // Solo en bulk aplicamos el filtro de cliente para no procesar contactos de otro cliente
    q = q.eq("client_id", body.client_id);
  }

  const { data: contacts, error: contactsError } = await q.limit(20);
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });
  if (!contacts?.length) return NextResponse.json({ pushed: 0, skipped: 0, generated: 0, errors: [], reason: "no_contacts" });

  // ── Empresas (nombre + fit_signals + deep_research para personalizar) ───────
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name, fit_signals, deep_research")
    .in("id", companyIds);

  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;
  const clientLabel = client?.name ? matchClientOption(client.name) : null;

  let pushed = 0, skipped = 0, generated = 0;
  const errors: { contact_id: string; error: string }[] = [];

  // ── Procesar secuencialmente (Claude + Lemlist + HubSpot) ─────────────────
  for (const contact of contacts) {
    const company     = companyById.get(contact.company_id);
    const companyName = company?.company_name ?? "";
    const hasEmail    = Boolean(contact.email?.trim());

    // 1) Generar mensajes si faltan ──────────────────────────────────────────
    const needsMessages =
      !contact.email_subject   ||
      !contact.email_body      ||
      !contact.linkedin_icebreaker;

    if (needsMessages) {
      try {
        const enrichedContext = [
          icpContext,
          company?.fit_signals && `Señales de fit de esta empresa: ${company.fit_signals}`,
        ].filter(Boolean).join("\n\n") || undefined;

        // Parsear deep_research si existe
        let deepResearch: { trigger: string; angulo: string; resumen_ejecutivo: string } | null = null;
        try {
          const raw = company?.deep_research;
          if (raw) deepResearch = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch { /* ignorar si no parsea */ }

        const msgs = await generateContactMessages({
          hasEmail,
          firstName:        contact.first_name        ?? undefined,
          lastName:         contact.last_name         ?? undefined,
          jobTitle:         contact.job_title         ?? undefined,
          linkedinHeadline: contact.linkedin_headline ?? undefined,
          companyName:      companyName               || undefined,
          icpContext:       enrichedContext,
          deepResearch,
          language:         "es",
        });

        const update: Record<string, string | undefined> = {};
        if (msgs.emailSubject)              update.email_subject       = msgs.emailSubject;
        if (msgs.emailBody)                 update.email_body          = msgs.emailBody;
        if (msgs.linkedinIcebreaker)        update.linkedin_icebreaker = msgs.linkedinIcebreaker;
        if (msgs.linkedinIcebreakerNoEmail) update.linkedin_icebreaker = msgs.linkedinIcebreakerNoEmail;

        if (Object.keys(update).length > 0) {
          await db.from("contacts").update(update).eq("id", contact.id);
          Object.assign(contact, update);
          generated++;
        }
      } catch (err: any) {
        errors.push({ contact_id: contact.id, error: `Generación mensajes: ${err?.message ?? "error"}` });
      }
    }

    // 2) Si no tiene ni email ni linkedin_url no hay forma de identificar el lead
    if (!hasEmail && !contact.linkedin_url?.trim()) {
      skipped++;
      continue;
    }

    // 3) Push a Lemlist ────────────────────────────────────────────────────────
    // Con email    → POST /campaigns/{id}/leads/{email}?verifyEmail=true&findPhone=true
    // Sin email    → POST /campaigns/{id}/leads?findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true
    //                El linkedinUrl va en el body; Lemlist busca el email internamente.
    const ENRICH = "findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true";

    const lemlistUrl = hasEmail
      ? `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(contact.email!)}?verifyEmail=true&findPhone=true`
      : `https://api.lemlist.com/api/campaigns/${campaignId}/leads?${ENRICH}`;

    const lemlistPayload: Record<string, string | undefined> = {
      firstName:    contact.first_name          ?? undefined,
      lastName:     contact.last_name           ?? undefined,
      companyName:  companyName                 || undefined,
      linkedinUrl:  contact.linkedin_url        ?? undefined,
      phone:        contact.phone               ?? undefined,
      icebreaker:   contact.linkedin_icebreaker ?? undefined,
      emailSubject: contact.email_subject       ?? undefined,
      emailBody:    contact.email_body          ?? undefined,
    };
    if (hasEmail) lemlistPayload.email = contact.email!;

    Object.keys(lemlistPayload).forEach(
      (k) => lemlistPayload[k] === undefined && delete lemlistPayload[k]
    );

    let lemRes: Response;
    try {
      lemRes = await fetch(lemlistUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
        body: JSON.stringify(lemlistPayload),
      });
    } catch (err: any) {
      errors.push({ contact_id: contact.id, error: err?.message ?? "Error de red" });
      continue;
    }

    if (!lemRes.ok) {
      const text = await lemRes.text().catch(() => "");
      if (lemRes.status === 409 || text.toLowerCase().includes("already")) {
        // Ya está — igual marcamos como pushed
      } else {
        errors.push({ contact_id: contact.id, error: `Lemlist ${lemRes.status}: ${text.slice(0, 150)}` });
        continue;
      }
    }

    await db
      .from("contacts")
      .update({ lemlist_pushed_at: new Date().toISOString(), status: "enriched" })
      .eq("id", contact.id);

    pushed++;

    // 4) Sync a HubSpot + script SDR (fire & forget, no bloquea el push) ────────
    const trainingCtxForScript = [
      trainingConfig.business_description && `Negocio: ${trainingConfig.business_description}`,
      trainingConfig.value_props          && `Propuesta de valor: ${trainingConfig.value_props}`,
      trainingConfig.talking_points       && `Puntos clave: ${trainingConfig.talking_points}`,
    ].filter(Boolean).join("\n") || null;

    syncToHubSpotWithScript({
      contact,
      companyName,
      fitSignals:     company?.fit_signals    ?? null,
      companyDbId:    contact.company_id      ?? null,
      clientName:     client?.name            ?? null,
      clientLabel,
      campaignId,
      hubspotOwnerId: config.hubspot_owner_id ?? null,
      icpContext:     icpContext              ?? null,
      trainingCtx:    trainingCtxForScript,
    }).catch(() => {/* no bloquea */});
  }

  return NextResponse.json({ pushed, skipped, generated, errors, reason: skipped > 0 && pushed === 0 ? "no_email" : undefined });
}

async function syncToHubSpotWithScript(opts: {
  contact:        Record<string, any>;
  companyName:    string;
  fitSignals:     string | null;
  companyDbId:    string | null;
  clientName:     string | null;
  clientLabel:    string | null;
  campaignId:     string;
  hubspotOwnerId: string | null;
  icpContext:     string | null;
  trainingCtx:    string | null;
}) {
  const { contact, companyName, fitSignals, companyDbId, clientName, clientLabel, campaignId, hubspotOwnerId, icpContext, trainingCtx } = opts;

  const isLushaPhone  = contact.phone_source === "lusha";
  const standardPhone = !isLushaPhone ? (contact.phone ?? null) : null;
  const lushaPhone    = isLushaPhone  ? (contact.phone ?? null) : null;

  // Score inicial: email enviado + boost de recencia (se recalculará con datos Lemlist posteriores)
  const engagementScore = computeEngagementScore({
    emailSent:         true,
    hasRecentActivity: true,
    emailReplies:      contact.status === "replied" ? 1 : 0,
  });

  // ── Empresa ────────────────────────────────────────────────────────────────
  let hsCompanyId: string | null = null;
  if (companyName) {
    const existingCompanyId = await searchHSCompany(companyName);
    const companyProps: Record<string, string | number | null | undefined> = {
      name:                     companyName,
      bullseye_fit_signals:     fitSignals    || undefined,
      bullseye_company_id:      companyDbId   || undefined,
      ...(clientLabel ? { cliente_bullseye_empresa: clientLabel } : {}),
    };
    hsCompanyId = await upsertHSCompany(companyProps, existingCompanyId);
  }

  // ── Contacto ───────────────────────────────────────────────────────────────
  const existingContactId = contact.email ? await searchHSContact(contact.email) : null;

  const contactProps: Record<string, string | number | null | undefined> = {
    email:                          contact.email               ?? undefined,
    firstname:                      contact.first_name          ?? undefined,
    lastname:                       contact.last_name           ?? undefined,
    jobtitle:                       contact.job_title           ?? undefined,
    phone:                          standardPhone               ?? undefined,
    linkedin_bio:                   contact.linkedin_url        ?? undefined,
    bullseye_contact_id:            contact.id,
    bullseye_client_name:           clientName                  ?? undefined,
    bullseye_seniority:             contact.seniority           ?? undefined,
    bullseye_linkedin_headline:     contact.linkedin_headline   ?? undefined,
    bullseye_email_subject:         contact.email_subject       ?? undefined,
    bullseye_email_body:            contact.email_body          ?? undefined,
    bullseye_linkedin_icebreaker:   contact.linkedin_icebreaker ?? undefined,
    bullseye_telefono_lusha:        lushaPhone                  ?? undefined,
    bullseye_fit_score:             contact.fit_score           ?? undefined,
    bullseye_engagement_score:      engagementScore,
    bullseye_status:                contact.status              ?? undefined,
    bullseye_lemlist_pushed_at:     new Date().toISOString(),
    bullseye_lemlist_campaign_id:   campaignId,
    bullseye_phone_source:          contact.phone_source        ?? undefined,
    ...(hubspotOwnerId ? { hubspot_owner_id: hubspotOwnerId } : {}),
  };

  const hsContactId = await upsertHSContact(contactProps, existingContactId);

  // ── Asociar contacto ↔ empresa ─────────────────────────────────────────────
  if (hsContactId && hsCompanyId) {
    await associateContactCompany(hsContactId, hsCompanyId);
  }

  // ── Script SDR IA (fire & forget) ─────────────────────────────────────────
  if (hsContactId) {
    generateSdrScript({
      firstName:   contact.first_name          ?? "",
      lastName:    contact.last_name           ?? "",
      jobTitle:    contact.job_title           ?? "",
      companyName,
      fitSignals,
      icpContext,
      trainingCtx,
      emailBody:   contact.email_body          ?? null,
      icebreaker:  contact.linkedin_icebreaker ?? null,
    })
      .then((script) => patchHSContact(hsContactId, { bullseye_script_sdr_ia: script }))
      .catch(() => {/* no bloquea */});
  }
}
