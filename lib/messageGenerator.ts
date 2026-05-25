import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export type ContactMessageInput = {
  hasEmail: boolean;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  companyName?: string;
  icpContext?: string;
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
    companyName,
    icpContext,
    language = "es",
  } = input;

  const contactInfo = [
    firstName && `Nombre: ${firstName}${lastName ? " " + lastName : ""}`,
    jobTitle && `Cargo: ${jobTitle}`,
    companyName && `Empresa: ${companyName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const langInstruction =
    language === "en"
      ? "Write all messages in English."
      : "Escribe todos los mensajes en español latinoamericano neutro.";

  const greeting = language === "en" ? "Hi {{firstName}}," : "Hola {{firstName}},";

  let userPrompt: string;

  if (hasEmail) {
    userPrompt = `${langInstruction}

Contexto del ICP:
${icpContext ?? "No disponible"}

Datos del contacto:
${contactInfo || "No disponibles"}

Genera los mensajes para la secuencia de Lemlist (RAMA CON EMAIL):
1. emailSubject: asunto del email inicial (máximo 7 palabras, sin signos de admiración, sin emojis)
2. emailBody: cuerpo del email — empieza EXACTAMENTE con "${greeting}\\n\\n", luego el texto. Máximo 5 oraciones. Sin bullets. Termina con una pregunta o CTA sutil.
3. linkedinIcebreaker: mensaje de chat LinkedIn para cuando acepta el invite (máximo 180 caracteres, sin saludo, sin emojis, directo al contexto relevante)

Responde ÚNICAMENTE con este JSON:
{"emailSubject":"...","emailBody":"...","linkedinIcebreaker":"..."}`;
  } else {
    userPrompt = `${langInstruction}

Contexto del ICP:
${icpContext ?? "No disponible"}

Datos del contacto:
${contactInfo || "No disponibles"}

Genera el mensaje para la secuencia de Lemlist (RAMA SIN EMAIL):
linkedinIcebreakerNoEmail: mensaje de chat LinkedIn final (máximo 180 caracteres, sin saludo, sin emojis, directo al contexto relevante del ICP)

Responde ÚNICAMENTE con este JSON:
{"linkedinIcebreakerNoEmail":"..."}`;
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
