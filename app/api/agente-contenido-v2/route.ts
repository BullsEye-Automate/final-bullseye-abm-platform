import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { getClientContext } from "@/lib/getClientContext";
import { supabaseAdmin, getUserIdFromRequest } from "@/lib/supabase";
import { logAiUsage } from "@/lib/aiUsageLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

const MSG_TYPE_LABELS: Record<string, string> = {
  cold:          "primer contacto frío",
  no_contact:    "seguimiento tras no poder contactar por teléfono",
  post_call:     "seguimiento post-llamada conectada",
  info:          "solicitud de más información",
  referral:      "contacto derivado por un conocido",
  meeting:       "confirmación de reunión agendada",
  meeting_brief: "previa de reunión (briefing para el vendedor)",
};

const CHANNEL_INSTRUCTIONS: Record<string, { label: string; length: string; hasSubject: boolean }> = {
  email:    { label: "Email",    length: "máximo 150 palabras en el cuerpo",                    hasSubject: true  },
  whatsapp: { label: "WhatsApp", length: "máximo 50 palabras, 3-4 líneas, tono conversacional", hasSubject: false },
  linkedin: { label: "LinkedIn", length: "máximo 80 palabras, tono profesional pero breve",     hasSubject: false },
};

async function fetchHubSpotContact(contactId: string) {
  const props = [
    "firstname","lastname","email","jobtitle","phone","lifecyclestage",
    "hs_lead_status","bullseye_estado_contacto","bullseye_sdr_asignado",
    "bullseye_canal_preferido","associatedcompanyid","num_contacted_notes",
    "notes_last_contacted",
  ].join(",");
  const r = await fetch(`${HS}/crm/v3/objects/contacts/${contactId}?properties=${props}&associations=companies`, {
    headers: hsHeaders(),
  });
  if (!r.ok) return null;
  return r.json();
}

async function fetchHubSpotCompany(companyId: string) {
  const props = [
    "name","domain","industry","numberofemployees","annualrevenue",
    "city","country","description","linkedin_company_page",
    "bullseye_estado","lifecyclestage","pais_g",
  ].join(",");
  const r = await fetch(`${HS}/crm/v3/objects/companies/${companyId}?properties=${props}`, {
    headers: hsHeaders(),
  });
  if (!r.ok) return null;
  return r.json();
}

function formatMeetingDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return raw;
  const [, y, mo, d, h, mi] = match;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi);
  return dt.toLocaleString("es-CL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function buildContactBlock(contact: any, company: any): string {
  if (!contact) return "";
  const p = contact.properties ?? {};
  const cp = company?.properties ?? {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ");

  const lines = [
    "── Datos del contacto (HubSpot) ──",
    name                      ? `Nombre: ${name}`                                                               : "",
    p.jobtitle                ? `Cargo: ${p.jobtitle}`                                                         : "",
    p.email                   ? `Email: ${p.email}`                                                            : "",
    p.phone                   ? `Teléfono: ${p.phone}`                                                         : "",
    p.bullseye_estado_contacto ? `Estado de gestión: ${p.bullseye_estado_contacto}`                            : "",
    p.num_contacted_notes     ? `Intentos de contacto realizados: ${p.num_contacted_notes}`                    : "",
    p.notes_last_contacted    ? `Último contacto: ${new Date(p.notes_last_contacted).toLocaleDateString("es-CL")}` : "",
    "",
    cp.name ? "── Datos de la empresa (HubSpot) ──" : "",
    cp.name           ? `Empresa: ${cp.name}`                                                                   : "",
    cp.industry       ? `Industria: ${cp.industry}`                                                             : "",
    cp.numberofemployees ? `Empleados: ${cp.numberofemployees}`                                                 : "",
    cp.annualrevenue  ? `Facturación anual (USD): ${Number(cp.annualrevenue).toLocaleString("es-CL")}`         : "",
    (cp.city || cp.pais_g || cp.country) ? `Ubicación: ${[cp.city, cp.pais_g || cp.country].filter(Boolean).join(", ")}` : "",
    cp.description    ? `Descripción: ${cp.description}`                                                        : "",
    cp.bullseye_estado ? `Estado de la empresa: ${cp.bullseye_estado}`                                         : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function buildSystemPrompt(
  ctx: Awaited<ReturnType<typeof getClientContext>>,
  recipient: {
    name?: string; company?: string; title?: string; emailType?: string;
    channel?: string; referrerName?: string; meetingDate?: string; meetingCountry?: string;
    contextNotes?: string; segmentStyleGuide?: string;
    contactBlock?: string; alloCallSummary?: string;
  }
): string {
  const contextBlock = ctx.aiContext.length
    ? ctx.aiContext.map((t, i) => `--- Documento ${i + 1} ---\n${t}`).join("\n\n")
    : "No hay documentos de contexto cargados para este cliente.";

  const icpBlock = ctx.icpNotes ? `\n\nPerfil de cliente ideal (ICP):\n${ctx.icpNotes}` : "";

  const typeLabel   = MSG_TYPE_LABELS[recipient.emailType ?? ""] ?? "";
  const channelInfo = CHANNEL_INSTRUCTIONS[recipient.channel ?? "email"] ?? CHANNEL_INSTRUCTIONS.email;
  const isMeetingBrief = recipient.emailType === "meeting_brief";

  const recipientLines = [
    recipient.name         ? `Nombre del contacto: ${recipient.name}`   : "",
    recipient.company      ? `Empresa: ${recipient.company}`            : "",
    recipient.title        ? `Cargo: ${recipient.title}`                : "",
    typeLabel              ? `Tipo de mensaje: ${typeLabel}`            : "",
    recipient.referrerName ? `Derivado por: ${recipient.referrerName}` : "",
    recipient.meetingDate  ? `Reunión para: ${formatMeetingDate(recipient.meetingDate)}${recipient.meetingCountry ? ` (${recipient.meetingCountry})` : ""}` : "",
    recipient.contextNotes ? `Contexto adicional: ${recipient.contextNotes}` : "",
  ].filter(Boolean).join("\n");

  const alloBlock = recipient.alloCallSummary
    ? `\n\nResumen de la última llamada (Allo):\n${recipient.alloCallSummary}`
    : "";

  const contactSection = recipient.contactBlock ? `\n\n${recipient.contactBlock}` : "";
  const styleBlock = recipient.segmentStyleGuide ? `\n\nGuía de estilo (aplica estrictamente):\n${recipient.segmentStyleGuide}` : "";

  const jsonFormat = isMeetingBrief
    ? null
    : channelInfo.hasSubject
      ? `{\n  "subject": "Asunto del mensaje",\n  "body": "Cuerpo con salto de línea \\n entre párrafos"\n}`
      : `{\n  "subject": "",\n  "body": "Texto del mensaje"\n}`;

  const typeInstructions: Record<string, string> = {
    no_contact:    `\n\nEste mensaje es para alguien que el SDR no logró contactar por teléfono. Reconoce que se intentó llamar, menciona brevemente el motivo del contacto, y ofrece otra forma de conectarse (correo, LinkedIn, WhatsApp).`,
    post_call:     `\n\nEste mensaje es post-llamada conectada. Retoma lo conversado en la llamada, avanza el siguiente paso acordado, y refuerza el valor propuesto de forma personalizada.`,
    meeting_brief: `\n\nGenera una previa de reunión (briefing interno) para quien va a reunirse con este contacto. Incluye: 1) Datos del contacto y empresa, 2) Por qué esta empresa es un buen fit según el ICP, 3) Posibles pain points o intereses según la industria y tamaño, 4) Puntos clave para mencionar de la propuesta de valor, 5) Posibles objeciones y cómo manejarlas. Tono ejecutivo, estructurado con secciones claras.`,
    meeting:       `\n\nConfirma la fecha y hora de la reunión. Recuerda brevemente la propuesta de valor y enmarca la reunión como una conversación exploratoria.`,
  };

  const extraInstruction = typeInstructions[recipient.emailType ?? ""] ?? "";
  const channelInstruction = isMeetingBrief
    ? ""
    : `Canal: ${channelInfo.label}. Extensión: ${channelInfo.length}. Adapta el tono y formato al canal.${channelInfo.hasSubject ? "" : " No incluyas asunto."} `;

  return `Eres un experto en prospección B2B que ayuda a los SDRs de ${ctx.clientName} a redactar mensajes hiperpersonalizados.

${channelInstruction}No incluyas firma, despedida con nombre ni datos de contacto. El SDR añadirá su propia firma. Nunca uses el carácter — (guión largo).

${recipientLines ? `Datos del destinatario:\n${recipientLines}` : ""}${contactSection}${alloBlock}

Contexto sobre ${ctx.clientName}:
${contextBlock}${icpBlock}${styleBlock}${extraInstruction}

Usa TODA la información disponible del contacto y la empresa para hiperpersonalizar el mensaje. Menciona detalles específicos de la industria, tamaño de empresa, cargo o situación del contacto.

${jsonFormat
    ? `Devuelve SIEMPRE este JSON sin markdown:\n${jsonFormat}\n\nPara ajustes, aplica directamente y devuelve el mensaje completo en JSON.`
    : `Devuelve el briefing como texto plano estructurado, con secciones numeradas y encabezados en MAYÚSCULAS. No uses JSON, no uses markdown, no uses asteriscos. Usa saltos de línea simples para separar elementos. Para ajustes, devuelve el briefing completo actualizado.`
  }`;
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const body = await req.json();
    const {
      clientId, messages, emailType, channel, segmentId,
      recipientName, recipientCompany, recipientTitle,
      referrerName, meetingDate, meetingCountry, contextNotes,
      hubspotContactId, alloCallSummary, save, image,
    } = body;

    if (!clientId || !messages?.length) {
      return NextResponse.json({ error: "clientId y messages son requeridos" }, { status: 400 });
    }

    let segmentStyleGuide: string | undefined;
    if (segmentId) {
      const db = supabaseAdmin();
      const { data: seg } = await db
        .from("training_segments")
        .select("name, message_focus, style_tone, style_rules, style_avoid, style_email_length")
        .eq("id", segmentId)
        .single();
      if (seg) {
        segmentStyleGuide = [
          `Segmento: ${seg.name}`,
          seg.message_focus      ? `Enfoque: ${seg.message_focus}`      : "",
          seg.style_tone         ? `Tono: ${seg.style_tone}`            : "",
          seg.style_email_length ? `Largo: ${seg.style_email_length}`   : "",
          seg.style_rules        ? `Reglas: ${seg.style_rules}`         : "",
          seg.style_avoid        ? `Evitar: ${seg.style_avoid}`         : "",
        ].filter(Boolean).join("\n");
      }
    }

    let contactBlock: string | undefined;
    if (hubspotContactId) {
      const contactData = await fetchHubSpotContact(hubspotContactId);
      let companyData = null;
      const companyId = contactData?.properties?.associatedcompanyid
        ?? contactData?.associations?.companies?.results?.[0]?.id;
      if (companyId) companyData = await fetchHubSpotCompany(companyId);
      contactBlock = buildContactBlock(contactData, companyData) || undefined;
    }

    const ctx = await getClientContext(clientId);
    const systemPrompt = buildSystemPrompt(ctx, {
      name: recipientName, company: recipientCompany, title: recipientTitle,
      emailType, channel: channel ?? "email",
      referrerName, meetingDate, meetingCountry, contextNotes,
      segmentStyleGuide, contactBlock, alloCallSummary,
    });

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
      max_tokens: 1500,
      system: systemPrompt,
      messages: chatMessages,
    });

    void logAiUsage({
      userId, clientId,
      functionName: "agente_contenido_v2",
      model: CLAUDE_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      metadata: { channel, emailType, hubspotContactId: !!hubspotContactId },
    });

    const assistantText = (response.content[0] as { type: string; text: string }).text ?? "";

    let parsed: { subject?: string; body?: string } | null = null;
    try {
      const match = assistantText.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {}

    if (save && parsed?.body) {
      const db = supabaseAdmin();
      await db.from("generated_emails").insert({
        client_id: clientId, email_type: emailType ?? "unknown",
        recipient_title: recipientTitle ?? null,
        referrer_name:   referrerName   ?? null,
        context_notes:   contextNotes   ?? null,
        subject:         parsed.subject ?? null,
        body:            parsed.body,
      });
    }

    return NextResponse.json({ message: assistantText, parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("agente-contenido-v2 error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
