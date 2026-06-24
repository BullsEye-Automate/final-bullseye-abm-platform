import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { getClientContext } from "@/lib/getClientContext";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_TYPE_LABELS: Record<string, string> = {
  info:     "más información sobre el servicio",
  referral: "contacto derivado por un conocido",
  cold:     "primer contacto frío",
};

type RecipientInfo = {
  name?: string;
  company?: string;
  title?: string;
  emailType?: string;
  referrerName?: string;
  contextNotes?: string;
  segmentStyleGuide?: string;
};

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof getClientContext>>, recipient: RecipientInfo): string {
  const contextBlock = ctx.aiContext.length
    ? ctx.aiContext.map((t, i) => `--- Documento ${i + 1} ---\n${t}`).join("\n\n")
    : "No hay documentos de contexto cargados para este cliente.";

  const icpBlock = ctx.icpNotes
    ? `\n\nPerfil de cliente ideal (ICP):\n${ctx.icpNotes}`
    : "";

  const typeLabel = EMAIL_TYPE_LABELS[recipient.emailType ?? ""] ?? "";
  const recipientBlock = [
    recipient.name    ? `- Nombre: ${recipient.name}`           : "",
    recipient.company ? `- Empresa: ${recipient.company}`       : "",
    recipient.title   ? `- Cargo: ${recipient.title}`           : "",
    typeLabel         ? `- Tipo de correo: ${typeLabel}`        : "",
    recipient.referrerName  ? `- Derivado por: ${recipient.referrerName}` : "",
    recipient.contextNotes  ? `- Contexto adicional: ${recipient.contextNotes}` : "",
  ].filter(Boolean).join("\n");

  const styleBlock = recipient.segmentStyleGuide
    ? `\n\nGuía de estilo para esta segmentación (aplica estrictamente):\n${recipient.segmentStyleGuide}`
    : "";

  return `Eres un asistente experto en prospección B2B que ayuda a los SDRs de ${ctx.clientName} a redactar correos de seguimiento y de más información.

Tu tono es profesional pero cercano. Los correos deben ser cortos (máx 150 palabras en el cuerpo), directos y con un CTA claro.

${recipientBlock ? `Datos del destinatario de esta sesión:\n${recipientBlock}\n\nUsa estos datos en todos los correos de esta conversación sin pedirlos de nuevo.` : ""}

Contexto sobre ${ctx.clientName}:
${contextBlock}${icpBlock}${styleBlock}

Cuando generes un correo, devuelve SIEMPRE este JSON (sin markdown extra):
{
  "subject": "Asunto del correo",
  "body": "Cuerpo del correo con salto de línea \\n entre párrafos"
}

Si el usuario adjunta una captura de pantalla de un correo o conversación, léela, entiende qué dijo el prospecto y genera una respuesta adecuada en el mismo formato JSON.

Para cualquier ajuste o variación, aplica los cambios directamente y devuelve el correo completo en JSON.`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, messages, emailType, segmentId, recipientName, recipientCompany, recipientTitle, referrerName, contextNotes, save, image } = body;

  if (!clientId || !messages?.length) {
    return NextResponse.json({ error: "clientId y messages son requeridos" }, { status: 400 });
  }

  // Carga guía de estilo del segmento si se seleccionó uno
  let segmentStyleGuide: string | undefined;
  if (segmentId) {
    const db = supabaseAdmin();
    const { data: seg } = await db
      .from("training_segments")
      .select("name, message_focus, style_tone, style_rules, style_avoid, style_email_length")
      .eq("id", segmentId)
      .single();
    if (seg) {
      const parts = [
        `Segmento: ${seg.name}`,
        seg.message_focus     ? `Enfoque del mensaje: ${seg.message_focus}`   : "",
        seg.style_tone        ? `Tono: ${seg.style_tone}`                     : "",
        seg.style_email_length? `Largo del correo: ${seg.style_email_length}` : "",
        seg.style_rules       ? `Reglas de escritura: ${seg.style_rules}`     : "",
        seg.style_avoid       ? `Evitar: ${seg.style_avoid}`                  : "",
      ].filter(Boolean);
      segmentStyleGuide = parts.join("\n");
    }
  }

  const ctx = await getClientContext(clientId);
  const systemPrompt = buildSystemPrompt(ctx, {
    name:              recipientName,
    company:           recipientCompany,
    title:             recipientTitle,
    emailType:         emailType,
    referrerName:      referrerName,
    contextNotes:      contextNotes,
    segmentStyleGuide: segmentStyleGuide,
  });

  // Construye los mensajes del chat
  const chatMessages: any[] = messages.map((m: { role: string; content: string }, idx: number) => {
    const isLastUser = m.role === "user" && idx === messages.length - 1;
    if (isLastUser && image?.base64) {
      return {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: m.content },
        ],
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: chatMessages,
  });

  const assistantText = (response.content[0] as { type: string; text: string }).text ?? "";

  // Intenta parsear JSON para guardar en Supabase
  let parsed: { subject?: string; body?: string } | null = null;
  try {
    const match = assistantText.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {}

  // Guarda en Supabase si el SDR lo pidió explícitamente o si es la primera generación
  if (save && parsed?.body) {
    const db = supabaseAdmin();
    await db.from("generated_emails").insert({
      client_id:       clientId,
      email_type:      emailType ?? "unknown",
      recipient_title: recipientTitle ?? null,
      referrer_name:   referrerName   ?? null,
      context_notes:   contextNotes   ?? null,
      subject:         parsed.subject ?? null,
      body:            parsed.body,
    });
  }

  return NextResponse.json({
    message: assistantText,
    parsed,
  });
}
