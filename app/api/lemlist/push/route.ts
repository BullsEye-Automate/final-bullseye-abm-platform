import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";

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

  // ── Configuración del cliente ───────────────────────────────────────────────
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", body.client_id)
    .maybeSingle();

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
  let q = db
    .from("contacts")
    .select("id, first_name, last_name, job_title, email, phone, linkedin_url, company_id, email_subject, email_body, linkedin_icebreaker")
    .eq("client_id", body.client_id)
    .eq("fit_action", "enrich")
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded");

  if (body.contact_ids?.length) {
    q = q.in("id", body.contact_ids);
  }

  const { data: contacts, error: contactsError } = await q.limit(20);
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });
  if (!contacts?.length) return NextResponse.json({ pushed: 0, skipped: 0, generated: 0, errors: [] });

  // ── Empresas (nombre + fit_signals para personalizar) ─────────────────────
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name, fit_signals")
    .in("id", companyIds);

  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  let pushed = 0, skipped = 0, generated = 0;
  const errors: { contact_id: string; error: string }[] = [];

  // ── Procesar secuencialmente (Claude + Lemlist) ────────────────────────────
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
        // Enriquece el contexto ICP con señales específicas de la empresa
        const enrichedContext = [
          icpContext,
          company?.fit_signals && `Señales de fit de esta empresa: ${company.fit_signals}`,
        ].filter(Boolean).join("\n\n") || undefined;

        const msgs = await generateContactMessages({
          hasEmail,
          firstName:   contact.first_name  ?? undefined,
          lastName:    contact.last_name   ?? undefined,
          jobTitle:    contact.job_title   ?? undefined,
          companyName: companyName         || undefined,
          icpContext:  enrichedContext,
          language:    "es",
        });

        // Guardar mensajes en la tabla de contactos
        const update: Record<string, string | undefined> = {};
        if (msgs.emailSubject)              update.email_subject       = msgs.emailSubject;
        if (msgs.emailBody)                 update.email_body          = msgs.emailBody;
        if (msgs.linkedinIcebreaker)        update.linkedin_icebreaker = msgs.linkedinIcebreaker;
        if (msgs.linkedinIcebreakerNoEmail) update.linkedin_icebreaker = msgs.linkedinIcebreakerNoEmail;

        if (Object.keys(update).length > 0) {
          await db.from("contacts").update(update).eq("id", contact.id);
          // Actualizar local para usar en el push a Lemlist
          Object.assign(contact, update);
          generated++;
        }
      } catch (err: any) {
        errors.push({ contact_id: contact.id, error: `Generación mensajes: ${err?.message ?? "error"}` });
        // Continuamos — push sin mensajes es mejor que no pushear
      }
    }

    // 2) Contactos sin email: guardar icebreaker y saltar Lemlist ─────────────
    if (!hasEmail) {
      skipped++;
      continue;
    }

    // 3) Push a Lemlist con mensajes como variables personalizadas ─────────────
    const lemlistPayload: Record<string, string | undefined> = {
      firstName:          contact.first_name        ?? undefined,
      lastName:           contact.last_name         ?? undefined,
      companyName:        companyName               || undefined,
      linkedinUrl:        contact.linkedin_url      ?? undefined,
      phone:              contact.phone             ?? undefined,
      // Mensajes generados — se usan como {{icebreaker}}, {{emailSubject}}, {{emailBody}} en la campaña
      icebreaker:         contact.linkedin_icebreaker ?? undefined,
      emailSubject:       contact.email_subject       ?? undefined,
      emailBody:          contact.email_body          ?? undefined,
    };

    // Limpiar undefined
    Object.keys(lemlistPayload).forEach(
      (k) => lemlistPayload[k] === undefined && delete lemlistPayload[k]
    );

    let lemRes: Response;
    try {
      lemRes = await fetch(
        `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(contact.email!)}`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
          body: JSON.stringify(lemlistPayload),
        }
      );
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
  }

  return NextResponse.json({ pushed, skipped, generated, errors });
}
