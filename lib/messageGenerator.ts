// Generación de mensajes de outreach personalizados para Lemlist.
// Soporta configuración de entrenamiento del modelo (ModelTrainingConfig).

import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelTrainingConfig } from "@/lib/modelTrainingConfig";

export type ContactMessageInput = {
  hasEmail: boolean;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  companyName?: string;
  companyType?: string;
  toolPrimary?: string;
  toolSecondary?: string;
  icpContext?: string;
  fitReason?: string;
  language?: "es" | "en";
  trainingConfig?: ModelTrainingConfig | null;
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

function buildTrainingContext(config: ModelTrainingConfig): string {
  const lines: string[] = [];
  if (config.business_name) lines.push(`Empresa: ${config.business_name}`);
  if (config.business_description) lines.push(`Descripción: ${config.business_description}`);
  if (config.target_buyer_persona) lines.push(`Buyer persona objetivo: ${config.target_buyer_persona}`);
  if (config.register) lines.push(`Registro/tono: ${config.register}`);
  if (config.talking_points?.length)
    lines.push(`Talking points: ${config.talking_points.join("; ")}`);
  if (config.value_props?.length)
    lines.push(`Propuestas de valor: ${config.value_props.join("; ")}`);
  if (config.forbidden_phrases?.length)
    lines.push(`FRASES PROHIBIDAS (nunca usar): ${config.forbidden_phrases.join(", ")}`);
  if (config.required_phrases?.length)
    lines.push(`Frases/conceptos requeridos: ${config.required_phrases.join(", ")}`);
  return lines.join("\n");
}

export async function generateContactMessages(
  input: ContactMessageInput
): Promise<ContactMessages> {
  const {
    hasEmail,
    firstName,
    lastName,
    jobTitle,
    companyName,
    companyType,
    toolPrimary,
    toolSecondary,
    icpContext,
    fitReason,
    language = "es",
    trainingConfig,
  } = input;

  const contactInfo = [
    firstName && `Nombre: ${firstName}${lastName ? " " + lastName : ""}`,
    jobTitle && `Cargo: ${jobTitle}`,
    companyName && `Empresa: ${companyName}`,
    companyType && `Tipo de empresa: ${companyType}`,
    toolPrimary && `Herramienta principal: ${toolPrimary}`,
    toolSecondary && `Herramienta secundaria: ${toolSecondary}`,
    fitReason && `Razón de fit IA: ${fitReason}`,
  ]
    .filter(Boolean)
    .join("\n");

  const langInstruction =
    language === "en"
      ? "Write all messages in English."
      : "Escribe todos los mensajes en español latinoamericano neutro.";

  const greeting = language === "en" ? "Hi {{firstName}}," : "Hola {{firstName}},";

  const icebreakerMaxChars = trainingConfig?.icebreaker_max_chars ?? 180;
  const subjectMaxWords = trainingConfig?.subject_max_words ?? 7;
  const bodyMaxWords = trainingConfig?.body_max_words ?? null;

  const trainingCtx = trainingConfig ? buildTrainingContext(trainingConfig) : null;

  let userPrompt: string;

  if (hasEmail) {
    userPrompt = `${langInstruction}

${trainingCtx ? `Contexto de la empresa vendedora:\n${trainingCtx}\n` : ""}
Contexto del ICP:
${icpContext ?? "No disponible"}

Datos del contacto:
${contactInfo || "No disponibles"}

Genera los mensajes para la secuencia de Lemlist (RAMA CON EMAIL):
1. emailSubject: asunto del email inicial (máximo ${subjectMaxWords} palabras, sin signos de admiración, sin emojis)
2. emailBody: cuerpo del email — empieza EXACTAMENTE con "${greeting}\\n\\n", luego el texto. ${bodyMaxWords ? `Máximo ${bodyMaxWords} palabras.` : "Máximo 5 oraciones."} Sin bullets. Termina con una pregunta o CTA sutil.
3. linkedinIcebreaker: mensaje de chat LinkedIn para cuando acepta el invite (máximo ${icebreakerMaxChars} caracteres, sin saludo, sin emojis, directo al contexto relevante)

Responde ÚNICAMENTE con este JSON:
{"emailSubject":"...","emailBody":"...","linkedinIcebreaker":"..."}`;
  } else {
    userPrompt = `${langInstruction}

${trainingCtx ? `Contexto de la empresa vendedora:\n${trainingCtx}\n` : ""}
Contexto del ICP:
${icpContext ?? "No disponible"}

Datos del contacto:
${contactInfo || "No disponibles"}

Genera el mensaje para la secuencia de Lemlist (RAMA SIN EMAIL):
linkedinIcebreakerNoEmail: mensaje de chat LinkedIn final (máximo ${icebreakerMaxChars} caracteres, sin saludo, sin emojis, directo al contexto relevante del ICP)

Responde ÚNICAMENTE con este JSON:
{"linkedinIcebreakerNoEmail":"..."}`;
  }

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = (message.content as Anthropic.ContentBlock[])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b: Anthropic.TextBlock) => b.text)
    .join("")
    .trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No se pudo parsear la respuesta de Claude");

  return JSON.parse(jsonMatch[0]) as ContactMessages;
}
