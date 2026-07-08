import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages, routeContactToSegment, type SegmentContext } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Genera (o regenera) la secuencia de mensajes de un contacto usando el
// enrutamiento a segmentos del cliente — misma lógica de /api/lemlist/push,
// pero sin pushear a Lemlist. Guarda el resultado como borrador editable en
// el contacto y devuelve qué segmento se usó para mostrarlo en el preview.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: contact, error } = await db
    .from("contacts")
    .select("id, client_id, company_id, first_name, last_name, job_title, linkedin_headline")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (!contact.client_id) return NextResponse.json({ error: "El contacto no tiene cliente asignado" }, { status: 400 });

  const clientId = contact.client_id;

  const { data: company } = await db
    .from("companies")
    .select("id, company_name, company_size, fit_signals, deep_research")
    .eq("id", contact.company_id)
    .maybeSingle();

  const [{ data: icpCtx }, { data: tc }, { data: segments }] = await Promise.all([
    db.from("client_ai_context")
      .select("content")
      .eq("client_id", clientId)
      .eq("file_type", "icp")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona, style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", clientId)
      .maybeSingle(),
    db.from("training_segments")
      .select("id, name, routing_hint, email_count, linkedin_msg_count, include_connect_msg")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
  ]);

  const icpContext = [
    icpCtx?.content,
    tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc?.value_props          && `Propuestas de valor: ${tc.value_props}`,
    tc?.talking_points       && `Puntos clave de conversación: ${tc.talking_points}`,
    tc?.target_buyer_persona && `Buyer persona: ${tc.target_buyer_persona}`,
    company?.fit_signals     && `Señales de fit de esta empresa: ${company.fit_signals}`,
  ].filter(Boolean).join("\n\n") || undefined;

  let deepResearch: { trigger: string; angulo: string; resumen_ejecutivo: string } | null = null;
  try {
    const raw = company?.deep_research;
    if (raw) deepResearch = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /* ignorar si no parsea */ }

  // Enrutamiento a segmento según la instrucción de cada cliente. Si el
  // cliente no tiene segmentos configurados, cae solo en mensaje
  // personalizado (mismo comportamiento de siempre).
  const routing = await routeContactToSegment(
    {
      firstName: contact.first_name ?? undefined,
      lastName: contact.last_name ?? undefined,
      jobTitle: contact.job_title ?? undefined,
      companyName: company?.company_name ?? undefined,
      companySize: company?.company_size ? String(company.company_size) : undefined,
    },
    segments ?? []
  );

  const matchedSegment = routing.segmentId ? (segments ?? []).find((s) => s.id === routing.segmentId) : null;

  const emailCount        = (matchedSegment?.email_count        as number | undefined) ?? 3;
  const linkedinMsgCount  = (matchedSegment?.linkedin_msg_count as number | undefined) ?? 2;
  const includeConnectMsg = (matchedSegment?.include_connect_msg as boolean | undefined) ?? false;

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

  // Ejemplos globales como fallback cuando no hay segmento (o el segmento no tiene ejemplos propios).
  const { data: globalExamples } = await db.from("message_examples").select("*")
    .eq("client_id", clientId).is("segment_id", null)
    .order("created_at", { ascending: false }).limit(5);

  let msgs;
  try {
    msgs = await generateContactMessages({
      hasEmail: true,
      firstName:        contact.first_name        ?? undefined,
      lastName:         contact.last_name         ?? undefined,
      jobTitle:         contact.job_title         ?? undefined,
      linkedinHeadline: contact.linkedin_headline ?? undefined,
      companyName:      company?.company_name     ?? undefined,
      icpContext,
      deepResearch,
      fewShotExamples: (globalExamples ?? []).map((e) => ({
        emailSubject: e.email_subject,
        emailBody:    e.email_body,
        icebreaker:   e.icebreaker ?? "",
        contactName:  e.contact_name ?? "",
        jobTitle:     e.job_title    ?? "",
      })),
      styleGuide: tc ? {
        tone:        tc.style_tone        ?? "",
        rules:       tc.style_rules       ?? "",
        avoid:       tc.style_avoid       ?? "",
        emailLength: tc.style_email_length ?? "corto",
      } : undefined,
      segmentContext,
      language: "es",
      clientId,
      emailCount,
      linkedinMsgCount,
      includeConnectMsg,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error generando mensajes" }, { status: 500 });
  }

  const update: Record<string, string> = {};
  if (msgs.emails?.[0]?.subject)  update.email_subject   = msgs.emails[0].subject;
  if (msgs.emails?.[0]?.body)     update.email_body      = msgs.emails[0].body;
  if (msgs.emails?.[1]?.subject)  update.email_subject_2 = msgs.emails[1].subject;
  if (msgs.emails?.[1]?.body)     update.email_body_2    = msgs.emails[1].body;
  if (msgs.emails?.[2]?.subject)  update.email_subject_3 = msgs.emails[2].subject;
  if (msgs.emails?.[2]?.body)     update.email_body_3    = msgs.emails[2].body;
  if (msgs.connectMessage)        update.connect_message   = msgs.connectMessage;
  if (msgs.linkedinMessages?.[0]) update.linkedin_icebreaker = msgs.linkedinMessages[0];
  if (msgs.linkedinMessages?.[1]) update.linkedin_msg_2      = msgs.linkedinMessages[1];
  // Compatibilidad modo simple (sin segmento con secuencia configurada)
  if (!msgs.emails?.length) {
    if (msgs.emailSubject)              update.email_subject       = msgs.emailSubject;
    if (msgs.emailBody)                 update.email_body          = msgs.emailBody;
    if (msgs.linkedinIcebreaker)        update.linkedin_icebreaker = msgs.linkedinIcebreaker;
    if (msgs.linkedinIcebreakerNoEmail) update.linkedin_icebreaker = msgs.linkedinIcebreakerNoEmail;
  }

  const { error: updErr } = await db.from("contacts").update(update).eq("id", contact.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    segment: { id: routing.segmentId, name: routing.segmentName, reasoning: routing.reasoning },
    messages: {
      email_subject:       update.email_subject       ?? null,
      email_body:          update.email_body          ?? null,
      email_subject_2:     update.email_subject_2     ?? null,
      email_body_2:        update.email_body_2        ?? null,
      email_subject_3:     update.email_subject_3     ?? null,
      email_body_3:        update.email_body_3        ?? null,
      connect_message:     update.connect_message     ?? null,
      linkedin_icebreaker: update.linkedin_icebreaker ?? null,
      linkedin_msg_2:      update.linkedin_msg_2      ?? null,
    },
  });
}
