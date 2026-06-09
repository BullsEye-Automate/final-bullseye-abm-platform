import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages, routeContactToSegment, type SegmentContext } from "@/lib/messageGenerator";

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

  const [{ data: config }, { data: icpCtx }, { data: tc }, { data: styleData }, { data: segments }] = await Promise.all([
    db.from("client_configs")
      .select("lemlist_campaign_id, hubspot_owner_id")
      .eq("client_id", body.client_id)
      .maybeSingle(),
    db.from("client_ai_context")
      .select("content")
      .eq("client_id", body.client_id)
      .eq("file_type", "icp")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona, style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", body.client_id)
      .maybeSingle(),
    db.from("model_training_config")
      .select("style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", body.client_id)
      .maybeSingle(),
    db.from("training_segments")
      .select("id, name, routing_hint, email_count, linkedin_msg_count, include_connect_msg")
      .eq("client_id", body.client_id)
      .order("created_at", { ascending: true }),
  ]);

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada en Config. cliente" }, { status: 400 });
  }

  const icpContext = [
    icpCtx?.content,
    tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc?.value_props          && `Propuestas de valor: ${tc.value_props}`,
    tc?.talking_points       && `Puntos clave de conversación: ${tc.talking_points}`,
    tc?.target_buyer_persona && `Buyer persona: ${tc.target_buyer_persona}`,
  ].filter(Boolean).join("\n\n") || undefined;

  // Si se pasan contact_ids específicos (flujo automático desde phone-enriched),
  // no filtramos por lemlist_pushed_at — el contacto puede tener el timestamp puesto
  // por bulk-approve-enrich como "queued para outreach".
  let q = db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, seniority, email, phone, phone_source, phone_clay, clay_phone_provider, clay_phone_received_at, linkedin_url, company_id, email_subject, email_body, email_subject_2, email_body_2, email_subject_3, email_body_3, connect_message, linkedin_icebreaker, linkedin_msg_2, fit_score")
    .eq("fit_action", "enrich")
    .neq("status", "discarded");

  if (body.contact_ids?.length) {
    q = q.in("id", body.contact_ids);
  } else {
    q = q.is("lemlist_pushed_at", null).eq("client_id", body.client_id);
  }

  const { data: contacts, error: contactsError } = await q.limit(20);
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });
  if (!contacts?.length) return NextResponse.json({ pushed: 0, skipped: 0, generated: 0, errors: [], reason: "no_contacts" });

  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name, company_size, fit_signals, deep_research")
    .in("id", companyIds);

  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  let pushed = 0, skipped = 0, generated = 0;
  const errors: { contact_id: string; error: string }[] = [];

  for (const contact of contacts) {
    const company     = companyById.get(contact.company_id);
    const companyName = company?.company_name ?? "";
    const hasEmail    = Boolean(contact.email?.trim());

    // Verificar si ya tiene mensajes de secuencia completa guardados
    const needsMessages =
      !contact.email_subject     ||
      !contact.email_body        ||
      !contact.linkedin_icebreaker ||
      contact.email_body?.includes("{{firstName}}");

    if (needsMessages) {
      try {
        const enrichedContext = [
          icpContext,
          company?.fit_signals && `Señales de fit de esta empresa: ${company.fit_signals}`,
        ].filter(Boolean).join("\n\n") || undefined;

        let deepResearch: { trigger: string; angulo: string; resumen_ejecutivo: string } | null = null;
        try {
          const raw = company?.deep_research;
          if (raw) deepResearch = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch { /* ignorar si no parsea */ }

        // Routing al segmento para obtener configuración de secuencia
        const routing = await routeContactToSegment(
          { firstName: contact.first_name ?? undefined, lastName: contact.last_name ?? undefined, jobTitle: contact.job_title ?? undefined, companyName, companySize: company?.company_size ? String(company.company_size) : undefined },
          segments ?? []
        );

        const matchedSegment = routing.segmentId
          ? (segments ?? []).find((s) => s.id === routing.segmentId)
          : null;

        const emailCount       = (matchedSegment?.email_count        as number | undefined) ?? 3;
        const linkedinMsgCount = (matchedSegment?.linkedin_msg_count as number | undefined) ?? 2;
        const includeConnectMsg = (matchedSegment?.include_connect_msg as boolean | undefined) ?? false;

        // Cargar contexto del segmento (fuentes + ejemplos)
        let segmentContext: SegmentContext | undefined;
        if (routing.segmentId) {
          const [{ data: sources }, { data: segExamples }] = await Promise.all([
            db.from("segment_sources").select("content, title, source_type")
              .eq("segment_id", routing.segmentId).not("content", "is", null),
            db.from("message_examples").select("*").eq("segment_id", routing.segmentId)
              .order("created_at", { ascending: false }).limit(5),
          ]);

          const sourcesText = (sources ?? [])
            .map((s) => [s.title && `### ${s.title}`, s.content].filter(Boolean).join("\n"))
            .join("\n\n");

          segmentContext = {
            id:       routing.segmentId,
            name:     routing.segmentName ?? "",
            sources:  sourcesText,
            examples: (segExamples ?? []).map((e) => ({
              emailSubject: e.email_subject,
              emailBody:    e.email_body,
              icebreaker:   e.icebreaker ?? "",
              contactName:  e.contact_name ?? "",
              jobTitle:     e.job_title    ?? "",
            })),
          };
        }

        // Ejemplos globales como fallback
        const { data: globalExamples } = await db.from("message_examples").select("*")
          .eq("client_id", body.client_id).is("segment_id", null)
          .order("created_at", { ascending: false }).limit(5);

        const msgs = await generateContactMessages({
          hasEmail,
          firstName:        contact.first_name        ?? undefined,
          lastName:         contact.last_name         ?? undefined,
          jobTitle:         contact.job_title         ?? undefined,
          linkedinHeadline: contact.linkedin_headline ?? undefined,
          companyName:      companyName               || undefined,
          icpContext:       enrichedContext,
          deepResearch,
          fewShotExamples: (globalExamples ?? []).map((e) => ({
            emailSubject: e.email_subject,
            emailBody:    e.email_body,
            icebreaker:   e.icebreaker ?? "",
            contactName:  e.contact_name ?? "",
            jobTitle:     e.job_title    ?? "",
          })),
          styleGuide: styleData ? {
            tone:        styleData.style_tone        ?? "",
            rules:       styleData.style_rules       ?? "",
            avoid:       styleData.style_avoid       ?? "",
            emailLength: styleData.style_email_length ?? "corto",
          } : undefined,
          segmentContext,
          language:          "es",
          emailCount,
          linkedinMsgCount,
          includeConnectMsg,
        });

        // Guardar secuencia completa en contacts
        const update: Record<string, string | undefined> = {};
        if (msgs.emails?.[0]?.subject)    update.email_subject   = msgs.emails[0].subject;
        if (msgs.emails?.[0]?.body)       update.email_body      = msgs.emails[0].body;
        if (msgs.emails?.[1]?.subject)    update.email_subject_2 = msgs.emails[1].subject;
        if (msgs.emails?.[1]?.body)       update.email_body_2    = msgs.emails[1].body;
        if (msgs.emails?.[2]?.subject)    update.email_subject_3 = msgs.emails[2].subject;
        if (msgs.emails?.[2]?.body)       update.email_body_3    = msgs.emails[2].body;
        if (msgs.connectMessage)          update.connect_message   = msgs.connectMessage;
        if (msgs.linkedinMessages?.[0])   update.linkedin_icebreaker = msgs.linkedinMessages[0];
        if (msgs.linkedinMessages?.[1])   update.linkedin_msg_2      = msgs.linkedinMessages[1];
        // Compatibilidad modo simple
        if (!msgs.emails?.length) {
          if (msgs.emailSubject)              update.email_subject       = msgs.emailSubject;
          if (msgs.emailBody)                 update.email_body          = msgs.emailBody;
          if (msgs.linkedinIcebreaker)        update.linkedin_icebreaker = msgs.linkedinIcebreaker;
          if (msgs.linkedinIcebreakerNoEmail) update.linkedin_icebreaker = msgs.linkedinIcebreakerNoEmail;
        }

        if (Object.keys(update).length > 0) {
          await db.from("contacts").update(update).eq("id", contact.id);
          Object.assign(contact, update);
          generated++;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ contact_id: contact.id, error: `Generación mensajes: ${errMsg}` });
      }
    }

    if (!hasEmail && !contact.linkedin_url?.trim()) {
      skipped++;
      continue;
    }

    // Teléfono se enriquece vía Clay waterfall (mejor calidad LATAM).
    // Si Clay no encontró teléfono (clay_phone_provider='none' o sin phone_clay),
    // pedimos a Lemlist que también busque teléfono como fallback.
    const clayHadNoPhone = (contact as any).clay_phone_provider === "none"
      || (!(contact as any).phone_clay && (contact as any).clay_phone_received_at);
    const findPhoneParam = clayHadNoPhone ? "&findPhone=true" : "";

    const ENRICH = `findEmail=true&verifyEmail=true&linkedinEnrichment=true${findPhoneParam}`;
    const lemlistUrl = hasEmail
      ? `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(contact.email!)}?verifyEmail=true${findPhoneParam}`
      : `https://api.lemlist.com/api/campaigns/${campaignId}/leads?${ENRICH}`;

    if (clayHadNoPhone) console.log(`[lemlist-push] Clay no encontró teléfono para ${contact.id} → activando findPhone en Lemlist como fallback`);

    // Construir payload con las 10 variables de secuencia
    const lemlistPayload: Record<string, string | undefined> = {
      firstName:       contact.first_name    ?? undefined,
      lastName:        contact.last_name     ?? undefined,
      companyName:     companyName           || undefined,
      linkedinUrl:     contact.linkedin_url  ?? undefined,
      phone:           contact.phone         ?? undefined,
      // Variables de secuencia
      emailSubject_1:  contact.email_subject   ?? undefined,
      emailBody_1:     contact.email_body      ?? undefined,
      emailSubject_2:  contact.email_subject_2 ?? undefined,
      emailBody_2:     contact.email_body_2    ?? undefined,
      emailSubject_3:  contact.email_subject_3 ?? undefined,
      emailBody_3:     contact.email_body_3    ?? undefined,
      connectMessage:  contact.connect_message   ?? undefined,
      linkedinMsg_1:   contact.linkedin_icebreaker ?? undefined,
      linkedinMsg_2:   contact.linkedin_msg_2      ?? undefined,
      bullseyeContactId: contact.id,
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ contact_id: contact.id, error: errMsg ?? "Error de red" });
      continue;
    }

    if (!lemRes.ok) {
      const text = await lemRes.text().catch(() => "");
      if (lemRes.status === 409 || text.toLowerCase().includes("already")) {
        // Ya está en la campaña — igual marcamos como pushed
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
  }

  console.log(`[lemlist-push] resultado: pushed=${pushed} errors=${errors.length}`);
  return NextResponse.json({ pushed, skipped, generated, errors, reason: skipped > 0 && pushed === 0 ? "no_email" : undefined });
}
