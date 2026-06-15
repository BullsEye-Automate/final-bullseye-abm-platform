import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const REVIEW_SYSTEM_PROMPT = `Eres un editor de mensajes de outreach B2B. Tu único trabajo es revisar y corregir mensajes generados por otra IA aplicando estas reglas OBLIGATORIAS:

1. IDIOMA: Solo español latinoamericano neutro. Corrige cualquier modismo argentino (vos, tenés, hacés, podés, che, laburo, boludo, pibe) o español de España (vale, tío, vosotros). Reemplaza con español neutro (tú, tienes, haces, puedes, etc.)
2. LÍMITES DE CARACTERES: connect_message máximo 190 caracteres. linkedin_msg máximo 400 caracteres. Si excede, acorta manteniendo el sentido.
3. GUIONES LARGOS: Nunca uses —. Reemplaza con coma o punto.
4. TONO: Directo, profesional, sin exageraciones ni signos de admiración.

Devuelve los mensajes corregidos. Si un mensaje no tiene errores, devuélvelo exactamente igual.`;

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
  // Configuración de secuencia (usado por el laboratorio de entrenamiento)
  emailCount?: number;          // cuántos emails generar (default 1)
  linkedinMsgCount?: number;    // cuántos mensajes de LinkedIn (default 1)
  includeConnectMsg?: boolean;  // incluir nota de invitación a conectar (default false)
};

// Tipo para un email individual dentro de una secuencia
export type SequenceEmail = { subject: string; body: string };

export type ContactMessages = {
  // Secuencia completa (usado cuando emailCount > 1 o linkedinMsgCount > 1)
  emails?: SequenceEmail[];
  linkedinMessages?: string[];
  connectMessage?: string;
  // Compatibilidad hacia atrás (primer email y primer icebreaker)
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

IDIOMA OBLIGATORIO: Escribe SIEMPRE en español latinoamericano neutro. NUNCA uses palabras, expresiones o modismos del español de Argentina, España u otro país específico. Ejemplos prohibidos: "che", "boludo", "vos" (usar "tú"), "laburo", "pibe", "tío", "vale", "vosotros", "tenés" (usar "tienes"), "hacés" (usar "haces"), "podés" (usar "puedes"). Usa vocabulario neutro entendible en cualquier país de Latinoamérica.

REGLA CRÍTICA: El "Contexto del ICP" describe la EMPRESA QUE HACE EL OUTREACH (el emisor).
Los "Datos del contacto" describen al PROSPECTO que recibe el mensaje.
NUNCA confundas la empresa emisora con la empresa del contacto.
Si la empresa del contacto es desconocida, NO la inventes ni uses el nombre de la empresa emisora.`;

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
    emailCount = 1,
    linkedinMsgCount = 1,
    includeConnectMsg = false,
  } = input;

  // Determinar si se necesita generar una secuencia completa
  const needsSequence = emailCount > 1 || linkedinMsgCount > 1 || includeConnectMsg;

  const systemPrompt = buildSystemPrompt(styleGuide, fewShotExamples, segmentContext);

  const deepResearchContext = deepResearch
    ? `\nInvestigación profunda de la empresa:\n- Trigger actual: ${deepResearch.trigger}\n- Ángulo de mensaje: ${deepResearch.angulo}\n- Resumen ejecutivo: ${deepResearch.resumen_ejecutivo}`
    : "";

  const contactInfo = [
    firstName && `Nombre: ${firstName}${lastName ? " " + lastName : ""}`,
    jobTitle && `Cargo: ${jobTitle}`,
    linkedinHeadline && `LinkedIn headline: ${linkedinHeadline}`,
    companyName ? `Empresa donde trabaja el contacto: ${companyName}` : "Empresa del contacto: desconocida (NO asumir que trabaja en la empresa emisora del outreach)",
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

  // ─── MODO SECUENCIA: más de un email, más de un msg LinkedIn, o connect msg ───
  if (needsSequence) {
    // Construir propiedades dinámicas para los emails de la secuencia (solo si tiene email)
    const emailProperties: Record<string, unknown> = {};
    const emailRequired: string[] = [];
    const effectiveEmailCount = hasEmail ? emailCount : 0;
    for (let i = 1; i <= effectiveEmailCount; i++) {
      emailProperties[`email${i}_subject`] = {
        type: "string",
        description: i === 1
          ? `Asunto del Email ${i} (primer contacto frío, máximo 7 palabras, sin signos de admiración, sin emojis)`
          : `Asunto del Email ${i} (follow-up, máximo 7 palabras, diferente al anterior)`,
      };
      emailProperties[`email${i}_body`] = {
        type: "string",
        description: i === 1
          ? `Cuerpo del Email ${i} (primer contacto frío). Debe empezar con "${greeting}" seguido de doble salto de línea. Sin bullets. Termina con pregunta o CTA sutil.`
          : `Cuerpo del Email ${i} (follow-up más corto que referencia el email anterior). Empieza con "${greeting}" + doble salto. 2-3 oraciones máximo.`,
      };
      emailRequired.push(`email${i}_subject`, `email${i}_body`);
    }

    // Propiedades para mensajes de LinkedIn
    const linkedinProperties: Record<string, unknown> = {};
    const linkedinRequired: string[] = [];
    for (let i = 1; i <= linkedinMsgCount; i++) {
      linkedinProperties[`linkedin_msg_${i}`] = {
        type: "string",
        description: `Mensaje de LinkedIn ${i} (post-conexión aceptada, máximo 400 caracteres, sin saludo formal, sin emojis, directo al valor)`,
      };
      linkedinRequired.push(`linkedin_msg_${i}`);
    }

    // Propiedad para mensaje de invitación a conectar (opcional)
    const connectProperties: Record<string, unknown> = includeConnectMsg
      ? {
          connect_message: {
            type: "string",
            description: "Nota para la invitación a conectar en LinkedIn (máximo 190 caracteres, muy personal y breve, sin emojis, como si fuera de persona a persona). IMPORTANTE: el texto no puede superar los 190 caracteres.",
          },
        }
      : {};

    const sequenceTool: Anthropic.Tool = {
      name: "generate_messages",
      description: `Genera una secuencia completa de outreach: ${effectiveEmailCount > 0 ? effectiveEmailCount + " email(s), " : ""}${linkedinMsgCount} mensaje(s) de LinkedIn${includeConnectMsg ? " y mensaje de invitación a conectar" : ""}`,
      input_schema: {
        type: "object" as const,
        properties: {
          ...emailProperties,
          ...connectProperties,
          ...linkedinProperties,
        },
        required: [...emailRequired, ...(includeConnectMsg ? ["connect_message"] : []), ...linkedinRequired],
      },
    };

    const sequencePrompt = `${langInstruction}

Contexto del ICP:
${icpContext ?? "No disponible"}${deepResearchContext}

Datos del contacto:
${contactInfo || "No disponibles"}

${deepResearch ? "IMPORTANTE: usa el trigger y ángulo de la investigación profunda para personalizar con eventos reales de la empresa." : ""}

Genera una secuencia completa de outreach para este contacto:
${effectiveEmailCount > 0 ? `- ${effectiveEmailCount} email(s): el primero es primer contacto frío, los siguientes son follow-ups más cortos que referencian el anterior\n` : ""}- ${linkedinMsgCount} mensaje(s) de LinkedIn: mensajes directos post-conexión aceptada, máximo 400 chars cada uno
${includeConnectMsg ? "- 1 mensaje de invitación a conectar en LinkedIn: nota muy personal, MÁXIMO 190 chars (obligatorio, no puede exceder)" : ""}

Usa la herramienta generate_messages para entregar la secuencia estructurada.`;

    const seqMessage = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [sequenceTool],
      tool_choice: { type: "tool", name: "generate_messages" },
      messages: [{ role: "user", content: sequencePrompt }],
    });

    const seqToolUse = seqMessage.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!seqToolUse) {
      const raw = seqMessage.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
      console.error("[generateContactMessages:sequence] Claude no usó tool_use. stop_reason:", seqMessage.stop_reason, "raw:", raw.slice(0, 300));
      throw new Error(`Claude no generó secuencia de mensajes (stop_reason: ${seqMessage.stop_reason})`);
    }

    const rawInput = seqToolUse.input as Record<string, string>;

    // Construir array de emails a partir de las propiedades dinámicas
    const emails: SequenceEmail[] = [];
    for (let i = 1; i <= effectiveEmailCount; i++) {
      emails.push({
        subject: rawInput[`email${i}_subject`] ?? "",
        body:    rawInput[`email${i}_body`]    ?? "",
      });
    }

    // Construir array de mensajes de LinkedIn
    const linkedinMessages: string[] = [];
    for (let i = 1; i <= linkedinMsgCount; i++) {
      linkedinMessages.push(rawInput[`linkedin_msg_${i}`] ?? "");
    }

    const result: ContactMessages = {
      emails,
      linkedinMessages,
      connectMessage: includeConnectMsg ? (rawInput["connect_message"] ?? undefined) : undefined,
      // Compatibilidad hacia atrás con código existente
      emailSubject:       emails[0]?.subject ?? "",
      emailBody:          emails[0]?.body    ?? "",
      linkedinIcebreaker: linkedinMessages[0] ?? "",
    };

    console.log("[generateContactMessages:sequence] OK — emails:", emails.length, "linkedin:", linkedinMessages.length, "connect:", !!result.connectMessage);
    return reviewMessages(result);
  }

  // ─── MODO SIMPLE: comportamiento original (1 email, 1 icebreaker) ─────────────

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
              description: "Mensaje de LinkedIn cuando acepta el invite (máximo 400 caracteres, sin saludo, sin emojis)",
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
              description: "Mensaje de LinkedIn (máximo 400 caracteres, sin saludo, sin emojis, directo al valor)",
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
  return reviewMessages(result);
}

// ─── Revisión y corrección automática con Haiku ───────────────────────────────

async function reviewMessages(msgs: ContactMessages): Promise<ContactMessages> {
  // Construir lista de campos a revisar
  const fields: Record<string, string> = {};
  if (msgs.emailSubject)              fields.emailSubject              = msgs.emailSubject;
  if (msgs.emailBody)                 fields.emailBody                 = msgs.emailBody;
  if (msgs.linkedinIcebreaker)        fields.linkedinIcebreaker        = msgs.linkedinIcebreaker;
  if (msgs.linkedinIcebreakerNoEmail) fields.linkedinIcebreakerNoEmail = msgs.linkedinIcebreakerNoEmail;
  if (msgs.connectMessage)            fields.connect_message           = msgs.connectMessage;
  msgs.emails?.forEach((e, i) => {
    if (e.subject) fields[`email${i + 1}_subject`] = e.subject;
    if (e.body)    fields[`email${i + 1}_body`]    = e.body;
  });
  msgs.linkedinMessages?.forEach((m, i) => {
    if (m) fields[`linkedin_msg_${i + 1}`] = m;
  });

  if (Object.keys(fields).length === 0) return msgs;

  const userPrompt = `Revisa y corrige estos mensajes:\n\n${JSON.stringify(fields, null, 2)}\n\nDevuelve SOLO un JSON con los mismos keys y los valores corregidos. Sin texto adicional.`;

  try {
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 3000,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("[reviewMessages] Haiku no devolvió JSON válido, usando original");
      return msgs;
    }

    const corrected = JSON.parse(match[0]) as Record<string, string>;
    console.log("[reviewMessages] OK — revisión completada con Haiku");

    // Aplicar correcciones al resultado
    const reviewed: ContactMessages = { ...msgs };

    if (corrected.emailSubject)              reviewed.emailSubject              = corrected.emailSubject;
    if (corrected.emailBody)                 reviewed.emailBody                 = corrected.emailBody;
    if (corrected.linkedinIcebreaker)        reviewed.linkedinIcebreaker        = corrected.linkedinIcebreaker;
    if (corrected.linkedinIcebreakerNoEmail) reviewed.linkedinIcebreakerNoEmail = corrected.linkedinIcebreakerNoEmail;
    if (corrected.connect_message)           reviewed.connectMessage            = corrected.connect_message;

    if (reviewed.emails) {
      reviewed.emails = reviewed.emails.map((e, i) => ({
        subject: corrected[`email${i + 1}_subject`] ?? e.subject,
        body:    corrected[`email${i + 1}_body`]    ?? e.body,
      }));
      // Sincronizar compat fields
      reviewed.emailSubject = reviewed.emails[0]?.subject ?? reviewed.emailSubject;
      reviewed.emailBody    = reviewed.emails[0]?.body    ?? reviewed.emailBody;
    }

    if (reviewed.linkedinMessages) {
      reviewed.linkedinMessages = reviewed.linkedinMessages.map(
        (m, i) => corrected[`linkedin_msg_${i + 1}`] ?? m
      );
      reviewed.linkedinIcebreaker = reviewed.linkedinMessages[0] ?? reviewed.linkedinIcebreaker;
    }

    return reviewed;
  } catch (err) {
    console.warn("[reviewMessages] Error en revisión Haiku, usando original:", err);
    return msgs;
  }
}
