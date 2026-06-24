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

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof getClientContext>>): string {
  const contextBlock = ctx.aiContext.length
    ? ctx.aiContext.map((t, i) => `--- Documento ${i + 1} ---\n${t}`).join("\n\n")
    : "No hay documentos de contexto cargados para este cliente.";

  const icpBlock = ctx.icpNotes
    ? `\n\nPerfil de cliente ideal (ICP):\n${ctx.icpNotes}`
    : "";

  return `Eres un asistente experto en prospección B2B que ayuda a los SDRs de ${ctx.clientName} a redactar correos de seguimiento y de más información.

Tu tono es profesional pero cercano. Los correos deben ser cortos (máx 150 palabras en el cuerpo), directos y con un CTA claro.

Contexto sobre ${ctx.clientName}:
${contextBlock}${icpBlock}

Cuando el usuario te pida generar un correo, devuelve SIEMPRE este JSON (sin markdown extra):
{
  "subject": "Asunto del correo",
  "body": "Cuerpo del correo con salto de línea \\n entre párrafos"
}

Para cualquier otra pregunta o ajuste, responde en texto plano.`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, messages, emailType, recipientName, recipientCompany, recipientTitle, referrerName, contextNotes, save } = body;

  if (!clientId || !messages?.length) {
    return NextResponse.json({ error: "clientId y messages son requeridos" }, { status: 400 });
  }

  const ctx = await getClientContext(clientId);
  const systemPrompt = buildSystemPrompt(ctx);

  // Construye los mensajes del chat
  const chatMessages = messages.map((m: { role: string; content: string }) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Si es el primer mensaje y viene contexto del formulario, lo inyecta
  if (chatMessages.length === 1 && emailType) {
    const typeLabel = EMAIL_TYPE_LABELS[emailType] ?? emailType;
    const parts: string[] = [
      `Genera un correo de ${typeLabel}.`,
      recipientName   ? `El destinatario se llama: ${recipientName}.`       : "",
      recipientCompany? `Trabaja en: ${recipientCompany}.`                  : "",
      recipientTitle  ? `Su cargo es: ${recipientTitle}.`                   : "",
      referrerName    ? `Es una derivación de: ${referrerName}.`            : "",
      contextNotes    ? `Contexto adicional: ${contextNotes}`               : "",
    ].filter(Boolean);
    chatMessages[0].content = parts.join(" ");
  }

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
