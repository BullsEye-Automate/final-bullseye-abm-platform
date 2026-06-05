import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export type DeepResearchContext = {
  trigger: string;
  angulo: string;
  resumen_ejecutivo: string;
};

export type FewShotExample = {
  emailSubject: string;
  emailBody: string;
  icebreaker: string;
  contactName?: string;
  jobTitle?: string;
};

export type StyleGuide = {
  tone?: string;
  rules?: string;
  avoid?: string;
  emailLength?: string;
};

export type Segment = {
  id: string;
  name: string;
  routing_hint: string;
};

export type SegmentContext = {
  id: string;
  name: string;
  sources: string; // contenido concatenado de las fuentes del segmento
  examples?: FewShotExample[];
};

export type ContactMessageInput = {
  hasEmail: boolean;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  linkedinHeadline?: string;
  companyName?: string;
  industry?: string;
  companySize?: string;
  icpContext?: string;
  deepResearch?: DeepResearchContext | null;
  fewShotExamples?: FewShotExample[];
  styleGuide?: StyleGuide;
  segmentContext?: SegmentContext;
  language?: "es" | "en";
};

export type ContactMessages = {
  emailSubject?: string;
  emailBody?: string;
  linkedinIcebreaker?: string;
  linkedinIcebreakerNoEmail?: string;
};

export type RoutingResult = {
  segmentId: string | null;
  segmentName: string | null;
  reasoning: string;
};

const BASE_SYSTEM_PROMPT = `Eres un experto en copywriting B2B y outbound sales.
Generas mensajes de outreach personalizados para secuencias de Lemlist.
Los mensajes deben ser directos, naturales y enfocados en aportar valor.
Usa el contexto del ICP proporcionado para personalizar cada mensaje.
NUNCA uses guiones largos (—). En su lugar usa comas o puntos según corresponda.
Responde ÚNICAMENTE con JSON válido, sin texto adicional.`;

const MAX_SOURCES_CHARS = 6000; // evitar prompts gigantes con PDFs largos

function buildSystemPrompt(
  styleGuide?: StyleGuide,
  fewShot?: FewShotExample[],
  segmentCtx?: SegmentContext
): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (segmentCtx?.sources?.trim()) {
    const sourcesText = segmentCtx.sources.length > MAX_SOURCES_CHARS
      ? segmentCtx.sources.slice(0, MAX_SOURCES_CHARS) + "\n[... contenido truncado por límite de contexto]"
      : segmentCtx.sources;
    parts.push(`\n## CONTEXTO ESPECÍFICO DEL SEGMENTO: ${segmentCtx.name.toUpperCase()}`);
    parts.push(sourcesText);
  }

  if (styleGuide?.tone || styleGuide?.rules || styleGuide?.avoid || styleGuide?.emailLength) {
    parts.push("\n## GUÍA DE ESTILO DEL CLIENTE (aplica siempre)");
    if (styleGuide.tone)        parts.push(`Tono: ${styleGuide.tone}`);
    if (styleGuide.emailLength) parts.push(`Largo de email: ${styleGuide.emailLength} (corto=3 oraciones, medio=4-5, largo=6+)`);
    if (styleGuide.rules)       parts.push(`Reglas de escritura:\n${styleGuide.rules}`);
    if (styleGuide.avoid)       parts.push(`NUNCA escribas:\n${styleGuide.avoid}`);
  }

  // Prioriza ejemplos del segmento; si no hay, usa los globales
  const examples = (segmentCtx?.examples?.length ? segmentCtx.examples : fewShot) ?? [];
  if (examples.length) {
    parts.push("\n## EJEMPLOS APROBADOS DE MENSAJES (imita este estilo)");
    examples.forEach((ex, i) => {
      parts.push(`\n--- Ejemplo ${i + 1}${ex.contactName ? ` (para ${ex.contactName}${ex.jobTitle ? ", " + ex.jobTitle : ""})` : ""} ---`);
      parts.push(`Subject: ${ex.emailSubject}`);
      parts.push(`Body: ${ex.emailBody}`);
      if (ex.icebreaker) parts.push(`Icebreaker: ${ex.icebreaker}`);
    });
    parts.push("\nIMPORTANTE: estos ejemplos muestran el tono, largo y estilo exacto. Adapta el contenido al nuevo contacto pero mantén el mismo estilo.");
  }

  return parts.join("\n");
}

// Determina qué segmento aplica a un contacto basado en su perfil
export async function routeContactToSegment(
  contact: {
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    companyName?: string;
    industry?: string;
    companySize?: string;
  },
  segments: Segment[]
): Promise<RoutingResult> {
  if (!segments.length) {
    return { segmentId: null, segmentName: null, reasoning: "Sin segmentos configurados" };
  }

  const segmentList = segments
    .map((s, i) => `${i + 1}. ID: "${s.id}" | Nombre: ${s.name} | Criterio: ${s.routing_hint}`)
    .join("\n");

  const contactProfile = [
    (contact.firstName || contact.lastName) && `Nombre: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`,
    contact.jobTitle    && `Cargo: ${contact.jobTitle}`,
    contact.companyName && `Empresa: ${contact.companyName}`,
    contact.industry    && `Industria: ${contact.industry}`,
    contact.companySize && `Tamaño de empresa: ${contact.companySize}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const message = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      system:
        "Eres un clasificador de contactos B2B. Dado un perfil de contacto y una lista de segmentos con criterios de enrutamiento, elige el segmento más apropiado. Responde SOLO con JSON válido, sin texto adicional.",
      messages: [
        {
          role: "user",
          content: `Perfil del contacto:\n${contactProfile || "Sin datos específicos"}\n\nSegmentos disponibles:\n${segmentList}\n\nElige el segmento más apropiado para este contacto. Si ninguno aplica claramente, elige el más cercano.\n\nResponde ÚNICAMENTE con este JSON:\n{"segment_id":"<id exacto del segmento>","reasoning":"<razón breve en 1 oración>"}`,
        },
      ],
    });

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { segmentId: null, segmentName: null, reasoning: "No se pudo parsear la respuesta" };

    const parsed = JSON.parse(match[0]);
    const matched = segments.find((s) => s.id === parsed.segment_id);

    return {
      segmentId:   matched?.id   ?? null,
      segmentName: matched?.name ?? null,
      reasoning:   parsed.reasoning ?? "",
    };
  } catch {
    return { segmentId: null, segmentName: null, reasoning: "Error en routing" };
  }
}

export async function generateContactMessages(
  input: ContactMessageInput
): Promise<ContactMessages> {
  const {
    hasEmail,
    firstName,
    lastName,
    jobTitle,
    linkedinHeadline,
    companyName,
    icpContext,
    deepResearch,
    fewShotExamples,
    styleGuide,
    segmentContext,
    language = "es",
  } = input;

  const systemPrompt = buildSystemPrompt(styleGuide, fewShotExamples, segmentContext);

  const deepResearchContext = deepResearch
    ? `\nInvestigación profunda de la empresa:\n- Trigger actual: ${deepResearch.trigger}\n- Ángulo de mensaje: ${deepResearch.angulo}\n- Resumen ejecutivo: ${deepResearch.resumen_ejecutivo}`
    : "";

  const contactInfo = [
    firstName && `Nombre: ${firstName}${lastName ? " " + lastName : ""}`,
    jobTitle && `Cargo: ${jobTitle}`,
    linkedinHeadline && `LinkedIn headline: ${linkedinHeadline}`,
    companyName && `Empresa: ${companyName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const langInstruction =
    language === "en"
      ? "Write all messages in English."
      : "Escribe todos los mensajes en español latinoamericano neutro.";

  const recipientName = firstName?.trim() ?? null;
  const greeting = recipientName
    ? (language === "en" ? `Hi ${recipientName},` : `Hola ${recipientName},`)
    : (language === "en" ? "Hi," : "Hola,");

  // Definición de la herramienta para forzar output estructurado
  const tool: Anthropic.Tool = hasEmail
    ? {
        name: "generate_messages",
        description: "Genera los mensajes de outreach para la secuencia de Lemlist",
        input_schema: {
          type: "object" as const,
          properties: {
            emailSubject: {
              type: "string",
              description: "Asunto del email (máximo 7 palabras, sin signos de admiración, sin emojis)",
            },
            emailBody: {
              type: "string",
              description: `Cuerpo del email. Debe empezar con "${greeting}" seguido de doble salto de línea. Sin bullets. Termina con pregunta o CTA sutil.`,
            },
            linkedinIcebreaker: {
              type: "string",
              description: "Mensaje de LinkedIn cuando acepta el invite (máximo 180 caracteres, sin saludo, sin emojis)",
            },
          },
          required: ["emailSubject", "emailBody", "linkedinIcebreaker"],
        },
      }
    : {
        name: "generate_messages",
        description: "Genera el mensaje de LinkedIn para contactos sin email",
        input_schema: {
          type: "object" as const,
          properties: {
            linkedinIcebreakerNoEmail: {
              type: "string",
              description: "Mensaje de LinkedIn (máximo 180 caracteres, sin saludo, sin emojis, directo al valor)",
            },
          },
          required: ["linkedinIcebreakerNoEmail"],
        },
      };

  const userPrompt = `${langInstruction}

Contexto del ICP:
${icpContext ?? "No disponible"}${deepResearchContext}

Datos del contacto:
${contactInfo || "No disponibles"}

${deepResearch ? "IMPORTANTE: usa el trigger y ángulo de la investigación profunda para personalizar con eventos reales de la empresa." : ""}

Genera los mensajes de outreach personalizados para este contacto usando la herramienta generate_messages.`;

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    tools: [tool],
    tool_choice: { type: "tool", name: "generate_messages" },
    messages: [{ role: "user", content: userPrompt }],
  });

  // Extraer el resultado del tool_use
  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

  if (!toolUse) {
    // Fallback: intentar parsear texto plano si Claude no usó la herramienta
    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    console.error("[generateContactMessages] Claude no usó tool_use. stop_reason:", message.stop_reason, "raw:", raw.slice(0, 300));
    throw new Error(`Claude no generó mensajes (stop_reason: ${message.stop_reason})`);
  }

  const result = toolUse.input as ContactMessages;
  console.log("[generateContactMessages] OK — subjectLen:", result.emailSubject?.length, "bodyLen:", result.emailBody?.length);
  return result;
}
