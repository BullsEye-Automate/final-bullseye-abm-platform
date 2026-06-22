import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages, routeContactToSegment, type SegmentContext } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_id, contact_id, manual, has_email_override } = body;

  if (!client_id) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();

  // Cargar todo en paralelo
  const [{ data: icpCtx }, { data: tc }, { data: styleData }, { data: segments }] = await Promise.all([
    db.from("client_ai_context").select("content").eq("client_id", client_id).eq("file_type", "icp")
      .order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", client_id).maybeSingle(),
    db.from("model_training_config")
      .select("style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", client_id).maybeSingle(),
    db.from("training_segments").select("id, name, routing_hint, email_count, linkedin_msg_count, include_connect_msg").eq("client_id", client_id)
      .order("created_at", { ascending: true }),
  ]);

  const icpContext = [
    icpCtx?.content,
    tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc?.value_props           && `Propuestas de valor: ${tc.value_props}`,
    tc?.talking_points        && `Puntos clave: ${tc.talking_points}`,
  ].filter(Boolean).join("\n\n") || undefined;

  // Datos del contacto
  let firstName: string | undefined;
  let lastName: string | undefined;
  let jobTitle: string | undefined;
  let companyName: string | undefined;
  let industry: string | undefined;
  let companySize: string | undefined;
  let linkedinHeadline: string | undefined;
  let hasEmail = true;

  if (contact_id) {
    const { data: contact, error: contactErr } = await db
      .from("contacts")
      .select("first_name, last_name, job_title, linkedin_headline, email, company_id, companies(company_name, company_size)")
      .eq("id", contact_id).maybeSingle();
    if (contactErr || !contact) return NextResponse.json({ error: contactErr?.message ?? "Contacto no encontrado" }, { status: 404 });

    firstName = contact.first_name ?? undefined;
    lastName  = contact.last_name  ?? undefined;
    jobTitle  = contact.job_title  ?? undefined;
    linkedinHeadline = contact.linkedin_headline ?? undefined;
    hasEmail = has_email_override !== undefined ? Boolean(has_email_override) : Boolean(contact.email?.trim());

    // Obtener datos de empresa via join (mismo patrón que la API de búsqueda)
    const co = Array.isArray(contact.companies) ? contact.companies[0] : contact.companies as Record<string, unknown> | null;
    companyName = (co?.company_name as string | null) ?? undefined;
    companySize = co?.company_size ? String(co.company_size) : undefined;
  } else if (manual) {
    firstName   = manual.firstName   || undefined;
    lastName    = manual.lastName    || undefined;
    jobTitle    = manual.jobTitle    || undefined;
    companyName = manual.companyName || undefined;
    industry    = manual.industry    || undefined;
    companySize = manual.companySize || undefined;
    hasEmail    = manual.hasEmail    ?? true;
  } else {
    return NextResponse.json({ error: "Se requiere contact_id o manual" }, { status: 400 });
  }

  // Routing de segmento
  const routing = await routeContactToSegment(
    { firstName, lastName, jobTitle, companyName, industry, companySize },
    segments ?? []
  );

  // Obtener configuración de secuencia del segmento asignado
  const matchedSegment = routing.segmentId
    ? (segments ?? []).find((s) => s.id === routing.segmentId)
    : null;
  const segmentEmailCount       = (matchedSegment as Record<string, unknown> | null)?.email_count       as number | undefined;
  const segmentLinkedinMsgCount = (matchedSegment as Record<string, unknown> | null)?.linkedin_msg_count as number | undefined;
  const segmentIncludeConnectMsg = (matchedSegment as Record<string, unknown> | null)?.include_connect_msg as boolean | undefined;

  // Cargar fuentes + ejemplos + guía de estilo del segmento elegido (en paralelo)
  let segmentContext: SegmentContext | undefined;
  if (routing.segmentId) {
    const [{ data: sources }, { data: segExamples }, { data: segStyle }] = await Promise.all([
      db.from("segment_sources").select("content, title, source_type")
        .eq("segment_id", routing.segmentId).not("content", "is", null),
      db.from("message_examples").select("*").eq("segment_id", routing.segmentId)
        .order("created_at", { ascending: false }).limit(5),
      db.from("training_segments")
        .select("message_focus, style_tone, style_rules, style_avoid, style_email_length")
        .eq("id", routing.segmentId).maybeSingle(),
    ]);

    const sourcesText = (sources ?? [])
      .map((s) => [s.title && `### ${s.title}`, s.content].filter(Boolean).join("\n"))
      .join("\n\n");

    const hasSegmentStyle = segStyle?.style_tone || segStyle?.style_rules || segStyle?.style_avoid || segStyle?.style_email_length;

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
      messageFocus: segStyle?.message_focus ?? undefined,
      styleGuide: hasSegmentStyle ? {
        tone:        segStyle?.style_tone         ?? "",
        rules:       segStyle?.style_rules        ?? "",
        avoid:       segStyle?.style_avoid        ?? "",
        emailLength: segStyle?.style_email_length ?? "corto",
      } : undefined,
    };
  }

  // Ejemplos globales (sin segmento) como fallback
  const { data: globalExamples } = await db.from("message_examples").select("*")
    .eq("client_id", client_id).is("segment_id", null)
    .order("created_at", { ascending: false }).limit(5);

  let msgs;
  try {
    msgs = await generateContactMessages({
      hasEmail,
      firstName,
      lastName,
      jobTitle,
      linkedinHeadline,
      companyName,
      industry,
      companySize,
      icpContext,
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
      language: "es",
      // Configuración de secuencia del segmento
      emailCount:        segmentEmailCount        ?? 1,
      linkedinMsgCount:  segmentLinkedinMsgCount  ?? 1,
      includeConnectMsg: segmentIncludeConnectMsg ?? false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lab] generateContactMessages falló:", msg);
    return NextResponse.json({ error: `Error generando mensajes: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({
    messages: msgs,
    contact: { firstName, lastName, jobTitle, companyName },
    routing,
  });
}
