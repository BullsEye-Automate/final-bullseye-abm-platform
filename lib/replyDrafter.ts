// Generador de borradores de respuesta para el módulo /respuestas — Sprint 6
// fase 3. Cuando un prospecto contesta la cadencia (LinkedIn o email), el SDR
// puede pedirle a Claude un borrador de respuesta antes de enviarla.
//
// Claude recibe: el texto de la respuesta del prospecto, su clasificación
// (interested / objection / question / ...), el contexto del contacto y la
// empresa, y la propuesta de valor de weCAD4you. Devuelve un solo borrador,
// adaptado al canal.
//
// El SDR siempre revisa y edita antes de enviar — esto es un asistente, no
// un autopilot.

import { createMessageWithFallback } from "./claude";
import { stripAiDashes, stripSignature } from "./messageGenerator";

export type ReplyDraftInput = {
  channel: string | null; // 'linkedin' | 'email'
  incoming_text: string; // lo que escribió el prospecto
  category: string | null; // clasificación IA/triage
  contact_name: string | null;
  first_name: string | null;
  job_title: string | null;
  company_name: string | null;
  company_type: string | null;
  cad_software: string | null;
  fit_signals: string | null;
};

export type ReplyDraft = { draft: string; model_used: string };

const SYSTEM_PROMPT = `You are the SDR for weCAD4you, a B2B service that designs dental CAD/CAM restorations (crowns, bridges, veneers) from STL files in exocad and Siemens inLab with 24h turnaround (6h rush). Customers are dental labs, multi-clinic groups and DSOs that already use digital workflows but lack CAD/CAM design capacity.

Value props: 24h turnaround, compatible with any intraoral scanner, 98.9% of designs need no adjustments, 14+ years of experience, lets the lab scale without hiring in-house designers.

A prospect REPLIED to your outreach (on LinkedIn or email). Write the SDR's reply. Your goal is to move the conversation toward a short call, while being genuinely helpful and never pushy. Output JSON only.`;

function buildUserPrompt(input: ReplyDraftInput): string {
  const channel = (input.channel ?? "").toLowerCase();
  const isLinkedin = channel === "linkedin";
  const firstName = input.first_name?.trim() || "there";

  const lines: string[] = [];
  lines.push(`PROSPECT:`);
  lines.push(`- Name: ${input.contact_name ?? "(unknown)"}`);
  lines.push(`- First name: ${input.first_name ?? "(unknown)"}`);
  lines.push(`- Job title: ${input.job_title ?? "(unknown)"}`);
  lines.push(`- Company: ${input.company_name ?? "(unknown)"}`);
  if (input.company_type) lines.push(`- Company type: ${input.company_type}`);
  if (input.cad_software) lines.push(`- CAD software: ${input.cad_software}`);
  if (input.fit_signals) lines.push(`- Fit signals: ${input.fit_signals}`);
  lines.push(`- Reply channel: ${input.channel ?? "(unknown)"}`);
  lines.push(`- AI classification of their reply: ${input.category ?? "(unclassified)"}`);
  lines.push(``);
  lines.push(`WHAT THE PROSPECT WROTE:`);
  lines.push(input.incoming_text.trim().slice(0, 6000));
  lines.push(``);
  lines.push(`Write the SDR's reply. Return STRICT JSON only with this shape:`);
  lines.push(`{ "draft": "<the reply text, ready to send>" }`);
  lines.push(``);
  lines.push(`RULES:`);
  lines.push(
    `- Write the reply in the SAME LANGUAGE as the prospect's message (most prospects write in English).`
  );
  if (isLinkedin) {
    lines.push(
      `- This is a LinkedIn chat reply: 2 to 4 short sentences, conversational. NO greeting line, NO signature, no links.`
    );
  } else {
    lines.push(
      `- This is an email reply: start with "Hi ${firstName}," then 2 to 4 short sentences. End with ONE low-commitment CTA question. NO signature or sign-off (the mailbox appends one).`
    );
  }
  lines.push(`- Category guidance:`);
  lines.push(
    `  · interested / meeting_request: propose a concrete next step (a quick 15-minute call, or offer to share a sample design). Be specific.`
  );
  lines.push(
    `  · objection: acknowledge it directly, reframe with ONE relevant value prop, end with a soft question. Do not get defensive.`
  );
  lines.push(
    `  · question: answer it concisely and accurately using only the value props above (never invent specifics, prices or timelines), then a soft CTA.`
  );
  lines.push(`  · referral: thank them and ask for a quick intro to the right person.`);
  lines.push(
    `  · not_interested / unsubscribe: keep it to ONE gracious sentence. No pitch, no CTA. Respect the no.`
  );
  lines.push(
    `  · auto_reply / other: a brief, friendly nudge appropriate to what they wrote.`
  );
  lines.push(
    `- Never invent facts about their company. Don't promise prices or timelines beyond the value props.`
  );
  lines.push(
    `- DO NOT use em-dash (—), en-dash (–) or hyphen (-) as a sentence separator. Use periods, commas, semicolons or colons.`
  );
  lines.push(`- Tone: a helpful peer in the dental industry, never salesy or generic.`);
  lines.push(``);
  lines.push(`Respond with the JSON object only, no prose around it.`);
  return lines.join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(body);
}

export async function draftReply(input: ReplyDraftInput): Promise<ReplyDraft> {
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }]
  });

  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude no devolvió texto");
  }
  const parsed = extractJson(block.text) as { draft?: unknown };
  let draft = String(parsed.draft ?? "").trim();
  if (!draft) throw new Error("Claude no devolvió un borrador");

  draft = stripAiDashes(draft);
  if ((input.channel ?? "").toLowerCase() === "email") {
    draft = stripSignature(draft);
  }
  draft = draft.trim();
  if (!draft) {
    throw new Error("El borrador quedó vacío después de sanitizar");
  }

  return { draft, model_used };
}
