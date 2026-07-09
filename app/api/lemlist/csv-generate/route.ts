import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages, routeContactToSegment, type SegmentContext } from "@/lib/messageGenerator";
import { runDeepResearch, type DeepResearchResult } from "@/lib/deep-research";

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
  deepResearchUsed?: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  let body: { client_id: string; contacts: ParsedContact[]; segment_id?: string; use_deep_research?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id, contacts, segment_id, use_deep_research = false } = body;
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
    db.from("training_segments").select("id, name, routing_hint, email_count, linkedin_msg_count, include_connect_msg, icp_industry_id").eq("client_id", client_id)
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

    const [{ data: sources }, { data: examples }, { data: segStyle }] = await Promise.all([
      db.from("segment_sources").select("content, title").eq("segment_id", segmentId).not("content", "is", null),
      db.from("message_examples").select("*").eq("segment_id", segmentId)
        .order("created_at", { ascending: false }).limit(5),
      db.from("training_segments")
        .select("message_focus, style_tone, style_rules, style_avoid, style_email_length")
        .eq("id", segmentId).maybeSingle(),
    ]);

    const hasSegmentStyle = segStyle?.style_tone || segStyle?.style_rules || segStyle?.style_avoid || segStyle?.style_email_length;

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
      messageFocus: segStyle?.message_focus ?? undefined,
      styleGuide: hasSegmentStyle ? {
        tone:        segStyle?.style_tone         ?? "",
        rules:       segStyle?.style_rules        ?? "",
        avoid:       segStyle?.style_avoid        ?? "",
        emailLength: segStyle?.style_email_length ?? "corto",
      } : undefined,
    };

    segmentCache.set(segmentId, ctx);
    return ctx;
  }

  // Cache de deep research por nombre de empresa (evita re-buscar para la misma empresa)
  const deepResearchCache = new Map<string, DeepResearchResult | null>();

  async function getDeepResearch(companyName: string): Promise<DeepResearchResult | null> {
    const key = companyName.trim().toLowerCase();
    if (deepResearchCache.has(key)) return deepResearchCache.get(key)!;

    // Buscar empresa en Supabase por nombre (tolerante: coincidencia parcial)
    const { data: company } = await db
      .from("companies")
      .select("id, company_name, company_website, company_linkedin_url, company_country, deep_research")
      .eq("client_id", client_id)
      .ilike("company_name", `%${companyName.trim()}%`)
      .limit(1)
      .maybeSingle();

    // Sin ICP no tiene sentido hacer research
    if (!icpContext?.trim()) {
      deepResearchCache.set(key, null);
      return null;
    }

    // Hacer deep research con Perplexity + Claude
    try {
      const result = await runDeepResearch({
        companyName,
        companyWebsite:  company?.company_website  ?? null,
        companyLinkedin: company?.company_linkedin_url ?? null,
        companyCountry:  company?.company_country  ?? null,
        icpContent:      icpContext,
      });

      // Guardar en Supabase si la empresa existe
      if (company?.id) {
        await db.from("companies")
          .update({ deep_research: JSON.stringify(result) })
          .eq("id", company.id);
      }

      deepResearchCache.set(key, result);
      return result;
    } catch (err) {
      console.warn(`[csv-generate] Deep research falló para ${companyName}:`, err);
      deepResearchCache.set(key, null);
      return null;
    }
  }

  // Pre-cargar ICP de industria de todos los segmentos que lo tengan configurado
  const uniqueIndustryIds = [...new Set((segments ?? []).map((s) => (s as Record<string, unknown>).icp_industry_id as string | null).filter(Boolean))] as string[];
  await Promise.all(uniqueIndustryIds.map((id) => getIndustryIcpContext(id)));

  // Segmentos enriquecidos con su ICP de industria para enrutamiento
  const enrichedSegments = (segments ?? []).map((s) => {
    const icpId = (s as Record<string, unknown>).icp_industry_id as string | null;
    return {
      ...s,
      icpIndustryContent: icpId ? (industryIcpCache.get(icpId) ?? null) : null,
    };
  });

  // Pre-buscar deep research de todas las empresas únicas en paralelo (solo si se solicitó)
  if (use_deep_research) {
    const uniqueCompanies = [...new Set(contacts.map((c) => c.companyName?.trim()).filter(Boolean))] as string[];
    await Promise.all(uniqueCompanies.map((name) => getDeepResearch(name)));
  }

  // El frontend ya controla el throttling (1 contacto cada 3s)
  // Aquí procesamos lo que llegue sin paralelismo adicional
  const results: GeneratedContact[] = [];

  for (let i = 0; i < contacts.length; i += 1) {
    const batch = contacts.slice(i, i + 1);
    const batchResults = await Promise.all(
      batch.map(async (c): Promise<GeneratedContact> => {
        try {
          // Usar segmento elegido manualmente; si no hay, hacer routing automático
          let resolvedSegmentId: string | null = segment_id ?? null;
          let resolvedSegmentName: string | null = null;

          if (!resolvedSegmentId) {
            const routing = await routeContactToSegment(
              { firstName: c.firstName, lastName: c.lastName, jobTitle: c.jobTitle, companyName: c.companyName, industry: c.industry, companySize: c.companySize },
              enrichedSegments
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

          let deepResearch: DeepResearchResult | null = null;
          if (use_deep_research && c.companyName?.trim()) {
            deepResearch = await getDeepResearch(c.companyName);
          }

          const msgs = await generateContactMessages({
            hasEmail:       Boolean(c.email?.trim()),
            firstName:      c.firstName   || undefined,
            lastName:       c.lastName    || undefined,
            jobTitle:       c.jobTitle    || undefined,
            companyName:    c.companyName || undefined,
            industry:       c.industry   || undefined,
            companySize:    c.companySize || undefined,
            icpContext,
            deepResearch,
            fewShotExamples: fewShotGlobal,
            styleGuide,
            segmentContext,
            clientId: client_id,
            language: "es",
            emailCount,
            linkedinMsgCount,
            includeConnectMsg,
          });

          return {
            ...c,
            emailSubject:      msgs.emails?.[0]?.subject ?? msgs.emailSubject,
            emailBody:         msgs.emails?.[0]?.body    ?? msgs.emailBody,
            emailSubject2:     msgs.emails?.[1]?.subject,
            emailBody2:        msgs.emails?.[1]?.body,
            emailSubject3:     msgs.emails?.[2]?.subject,
            emailBody3:        msgs.emails?.[2]?.body,
            connectMessage:    msgs.connectMessage,
            icebreaker:        msgs.linkedinMessages?.[0] ?? msgs.linkedinIcebreaker ?? msgs.linkedinIcebreakerNoEmail,
            linkedinMsg2:      msgs.linkedinMessages?.[1],
            segmentName:       resolvedSegmentName ?? undefined,
            deepResearchUsed:  use_deep_research ? (deepResearch !== null) : undefined,
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
