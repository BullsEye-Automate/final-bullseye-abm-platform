import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages, routeContactToSegment, type SegmentContext } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ParsedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  industry?: string;
  companySize?: string;
};

type GeneratedContact = ParsedContact & {
  emailSubject?: string;
  emailBody?: string;
  emailSubject2?: string;
  emailBody2?: string;
  emailSubject3?: string;
  emailBody3?: string;
  connectMessage?: string;
  icebreaker?: string;
  linkedinMsg2?: string;
  segmentName?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  let body: { client_id: string; contacts: ParsedContact[]; segment_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id, contacts, segment_id } = body;
  if (!client_id || !contacts?.length) {
    return NextResponse.json({ error: "Se requiere client_id y contacts" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Cargar todo el contexto del cliente en paralelo
  const [{ data: icpCtx }, { data: tc }, { data: styleData }, { data: segments }, { data: globalExamples }] = await Promise.all([
    db.from("client_ai_context").select("content").eq("client_id", client_id)
      .eq("file_type", "icp").order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona")
      .eq("client_id", client_id).maybeSingle(),
    db.from("model_training_config")
      .select("style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", client_id).maybeSingle(),
    db.from("training_segments").select("id, name, routing_hint, email_count, linkedin_msg_count, include_connect_msg").eq("client_id", client_id)
      .order("created_at", { ascending: true }),
    db.from("message_examples").select("*").eq("client_id", client_id).is("segment_id", null)
      .order("created_at", { ascending: false }).limit(5),
  ]);

  const icpContext = [
    icpCtx?.content,
    tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc?.value_props          && `Propuestas de valor: ${tc.value_props}`,
    tc?.talking_points       && `Puntos clave de conversación: ${tc.talking_points}`,
    tc?.target_buyer_persona && `Buyer persona: ${tc.target_buyer_persona}`,
  ].filter(Boolean).join("\n\n") || undefined;

  const styleGuide = styleData ? {
    tone:        styleData.style_tone        ?? "",
    rules:       styleData.style_rules       ?? "",
    avoid:       styleData.style_avoid       ?? "",
    emailLength: styleData.style_email_length ?? "corto",
  } : undefined;

  const fewShotGlobal = (globalExamples ?? []).map((e) => ({
    emailSubject: e.email_subject,
    emailBody:    e.email_body,
    icebreaker:   e.icebreaker ?? "",
    contactName:  e.contact_name ?? "",
    jobTitle:     e.job_title    ?? "",
  }));

  // Cache de contextos de segmento (evita re-fetching para el mismo segmento)
  const segmentCache = new Map<string, SegmentContext>();

  async function getSegmentContext(segmentId: string, segmentName: string): Promise<SegmentContext> {
    if (segmentCache.has(segmentId)) return segmentCache.get(segmentId)!;

    const [{ data: sources }, { data: examples }] = await Promise.all([
      db.from("segment_sources").select("content, title").eq("segment_id", segmentId).not("content", "is", null),
      db.from("message_examples").select("*").eq("segment_id", segmentId)
        .order("created_at", { ascending: false }).limit(5),
    ]);

    const ctx: SegmentContext = {
      id:      segmentId,
      name:    segmentName,
      sources: (sources ?? []).map((s) => [s.title && `### ${s.title}`, s.content].filter(Boolean).join("\n")).join("\n\n"),
      examples: (examples ?? []).map((e) => ({
        emailSubject: e.email_subject,
        emailBody:    e.email_body,
        icebreaker:   e.icebreaker ?? "",
        contactName:  e.contact_name ?? "",
        jobTitle:     e.job_title    ?? "",
      })),
    };

    segmentCache.set(segmentId, ctx);
    return ctx;
  }

  const BATCH_SIZE = 3;
  const results: GeneratedContact[] = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (c): Promise<GeneratedContact> => {
        try {
          // Usar segmento elegido manualmente; si no hay, hacer routing automático
          let resolvedSegmentId: string | null = segment_id ?? null;
          let resolvedSegmentName: string | null = null;

          if (!resolvedSegmentId) {
            const routing = await routeContactToSegment(
              { firstName: c.firstName, lastName: c.lastName, jobTitle: c.jobTitle, companyName: c.companyName, industry: c.industry, companySize: c.companySize },
              segments ?? []
            );
            resolvedSegmentId   = routing.segmentId;
            resolvedSegmentName = routing.segmentName;
          } else {
            resolvedSegmentName = (segments ?? []).find((s) => s.id === resolvedSegmentId)?.name ?? null;
          }

          let segmentContext: SegmentContext | undefined;
          const matchedSegment = resolvedSegmentId
            ? (segments ?? []).find((s) => s.id === resolvedSegmentId)
            : null;

          if (resolvedSegmentId && resolvedSegmentName) {
            segmentContext = await getSegmentContext(resolvedSegmentId, resolvedSegmentName);
          }

          const emailCount        = (matchedSegment as Record<string, unknown> | null)?.email_count        as number ?? 3;
          const linkedinMsgCount  = (matchedSegment as Record<string, unknown> | null)?.linkedin_msg_count as number ?? 2;
          const includeConnectMsg = (matchedSegment as Record<string, unknown> | null)?.include_connect_msg as boolean ?? false;

          const msgs = await generateContactMessages({
            hasEmail:       Boolean(c.email?.trim()),
            firstName:      c.firstName   || undefined,
            lastName:       c.lastName    || undefined,
            jobTitle:       c.jobTitle    || undefined,
            companyName:    c.companyName || undefined,
            industry:       c.industry   || undefined,
            companySize:    c.companySize || undefined,
            icpContext,
            fewShotExamples: fewShotGlobal,
            styleGuide,
            segmentContext,
            language: "es",
            emailCount,
            linkedinMsgCount,
            includeConnectMsg,
          });

          return {
            ...c,
            emailSubject:  msgs.emails?.[0]?.subject ?? msgs.emailSubject,
            emailBody:     msgs.emails?.[0]?.body    ?? msgs.emailBody,
            emailSubject2: msgs.emails?.[1]?.subject,
            emailBody2:    msgs.emails?.[1]?.body,
            emailSubject3: msgs.emails?.[2]?.subject,
            emailBody3:    msgs.emails?.[2]?.body,
            connectMessage: msgs.connectMessage,
            icebreaker:    msgs.linkedinMessages?.[0] ?? msgs.linkedinIcebreaker ?? msgs.linkedinIcebreakerNoEmail,
            linkedinMsg2:  msgs.linkedinMessages?.[1],
            segmentName:   resolvedSegmentName ?? undefined,
          };
        } catch (err: any) {
          return { ...c, error: err?.message ?? "Error de generación" };
        }
      })
    );
    results.push(...batchResults);
  }

  return NextResponse.json({ results });
}
