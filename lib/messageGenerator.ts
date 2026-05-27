import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export type DeepResearchContext = {
  trigger: string;
  angulo: string;
  resumen_ejecutivo: string;
};

export type ContactMessageInput = {
  hasEmail: boolean;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  linkedinHeadline?: string;
  companyName?: string;
  icpContext?: string;
  deepResearch?: DeepResearchContext | null;
  language?: "es" | "en";
};

export type ContactMessages = {
  // Rama CON email
  emailSubject?: string;
  emailBody?: string;
  linkedinIcebreaker?: string;
  // Rama SIN email
  linkedinIcebreakerNoEmail?: string;
};

const SYSTEM_PROMPT = `Eres un experto en copywriting B2B y outbound sales.
Generas mensajes de outreach personalizados para secuencias de Lemlist.
Los mensajes deben ser directos, naturales y enfocados en aportar valor.
Usa el contexto del ICP proporcionado para personalizar cada mensaje.
Responde ÚNICAMENTE con JSON válido, sin texto adicional.`;

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
    language = "es",
  } = input;

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
    ? (language === "en" ? `Hi ${recipientName},`           : `Hola ${recipientName}! ¿Cómo estás?`)
    : (language === "en" ? "Hi,"                            : "Hola! ¿Cómo estás?");

  let userPrompt: string;

  if (hasEmail) {
    userPrompt = `${langInstruction}\n\nContexto del ICP:\n${icpContext ?? "No disponible"}${deepResearchContext}\n\nDatos del contacto:\n${contactInfo || "No disponibles"}\n\nGenera los mensajes para la secuencia de Lemlist (RAMA CON EMAIL).\n${deepResearch ? "IMPORTANTE: usa el trigger y ángulo de la investigación profunda para personalizar los mensajes con un evento o señal real y verificable de la empresa." : ""}\n1. emailSubject: asunto del email inicial (máximo 7 palabras, sin signos de admiración, sin emojis)\n2. emailBody: cuerpo del email — empieza EXACTAMENTE con "${greeting}\\n\\n", luego el texto. Máximo 5 oraciones. Sin bullets. Termina con una pregunta o CTA sutil.\n3. linkedinIcebreaker: mensaje de chat LinkedIn para cuando acepta el invite (máximo 180 caracteres, sin saludo, sin emojis, directo al contexto relevante)\n\nResponde ÚNICAMENTE con este JSON:\n{"emailSubject":"...","emailBody":"...","linkedinIcebreaker":"..."}`;
  } else {
    userPrompt = `${langInstruction}\n\nContexto del ICP:\n${icpContext ?? "No disponible"}${deepResearchContext}\n\nDatos del contacto:\n${contactInfo || "No disponibles"}\n\nGenera el mensaje para la secuencia de Lemlist (RAMA SIN EMAIL).\n${deepResearch ? "IMPORTANTE: usa el trigger y ángulo de la investigación profunda para personalizar con un evento real y verificable de la empresa." : ""}\nlinkedinIcebreakerNoEmail: mensaje de chat LinkedIn final (máximo 180 caracteres, sin saludo, sin emojis, directo al contexto relevante del ICP)\n\nResponde ÚNICAMENTE con este JSON:\n{"linkedinIcebreakerNoEmail":"..."}`;
  }

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No se pudo parsear la respuesta de Claude");

  return JSON.parse(jsonMatch[0]) as ContactMessages;
}
