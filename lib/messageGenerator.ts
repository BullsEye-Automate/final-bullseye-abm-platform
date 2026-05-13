// Generador de mensajes hiperpersonalizados (LinkedIn icebreaker + email
// subject + email body) para contactos manual_review aprobados.
//
// Por qué vive en la app y no en Clay: Clay solo corre AI columns cuando
// Lead Scoring action = "enrich". Los contactos en manual_review aprobados
// por humano no disparan esas columnas, así que la app genera los mensajes
// por su cuenta antes de empujar a Lemlist.
//
// Reglas críticas del icebreaker (ver CLAUDE.md "URGENTE — icebreaker"):
//   - Máximo 180 chars (LinkedIn corta invitaciones a 200; dejamos margen).
//   - NO incluir "Hi {firstName}, " — la plantilla Lemlist del Día 3 ya lo
//     prepende. Si lo incluímos doble sale: "Hi Brittany , Brittany, ...".
//
// Reglas del email body: SÍ incluir "Hi {firstName}," al inicio (la
// plantilla del paso Día 5 en Lemlist espera solo {{emailBody}}, sin
// saludo adicional — ver notas_arquitectura.md §7).

import { createMessageWithFallback } from "./claude";

export type MessageInput = {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  seniority: string | null;
  company_name: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
};

export type GeneratedMessages = {
  linkedin_icebreaker: string;
  email_subject: string;
  email_body: string;
  model_used: string;
};

const SYSTEM_PROMPT = `You are the SDR for weCAD4you, a B2B service that designs dental CAD/CAM restorations (crowns, bridges, veneers) from STL files in exocad and Siemens inLab with 24h turnaround (6h rush). Customers are dental labs, multi-clinic groups and DSOs that already use digital workflows but lack CAD/CAM design capacity.

Value props: 24h turnaround, compatible with any intraoral scanner, 98.9% of designs need no adjustments, 14+ years experience, lets the lab scale without hiring designers.

You write outreach for ONE prospect at a time. Output JSON only.`;

function buildUserPrompt(input: MessageInput): string {
  const fullName = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();
  const lines: string[] = [];
  lines.push(`PROSPECT:`);
  lines.push(`- First name: ${input.first_name ?? "(unknown)"}`);
  lines.push(`- Full name: ${fullName || "(unknown)"}`);
  lines.push(`- Job title: ${input.job_title ?? "(unknown)"}`);
  if (input.linkedin_headline) lines.push(`- LinkedIn headline: ${input.linkedin_headline}`);
  if (input.seniority) lines.push(`- Seniority: ${input.seniority}`);
  lines.push(``);
  lines.push(`COMPANY:`);
  lines.push(`- Name: ${input.company_name ?? "(unknown)"}`);
  if (input.company_size != null) lines.push(`- Size: ${input.company_size} employees`);
  if (input.company_type) lines.push(`- Type: ${input.company_type}`);
  if (input.cad_software) lines.push(`- CAD software: ${input.cad_software}`);
  if (input.scanner_technology) lines.push(`- Scanner technology: ${input.scanner_technology}`);
  if (input.fit_signals) lines.push(`- Fit signals: ${input.fit_signals}`);
  lines.push(``);
  lines.push(`Generate three pieces of outreach. Return STRICT JSON only with this shape:`);
  lines.push(`{`);
  lines.push(`  "linkedin_icebreaker": "<single line, MAX 180 characters, NO greeting>",`);
  lines.push(`  "email_subject": "<MAX 7 words>",`);
  lines.push(`  "email_body": "<starts with 'Hi {firstName},' newline, then body>"`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`RULES for linkedin_icebreaker:`);
  lines.push(`- MAX 180 characters total (counted strictly).`);
  lines.push(`- NEVER include "Hi ${input.first_name ?? "{firstName}"}, " or any greeting. Start with the substantive content directly.`);
  lines.push(`- Mention ONE specific signal about THEIR company (the fit signal, their software, their growth, their hiring, etc.). Do not invent facts.`);
  lines.push(`- Tone: dental industry peer, never salesy or generic.`);
  lines.push(`- End with a low-commitment question.`);
  lines.push(`- NO links, NO emojis, NO line breaks.`);
  lines.push(``);
  lines.push(`RULES for email_subject:`);
  lines.push(`- MAX 7 words.`);
  lines.push(`- Specific to them (mention company name, software, or signal).`);
  lines.push(`- No clickbait, no caps lock, no emojis.`);
  lines.push(``);
  lines.push(`RULES for email_body:`);
  lines.push(`- Start with "Hi ${input.first_name ?? "there"},\\n\\n".`);
  lines.push(`- Line 1: something specific about them (the fit signal or their setup).`);
  lines.push(`- Line 2: what weCAD4you does in one sentence.`);
  lines.push(`- Line 3: a concrete, specific result (24h turnaround, 98.9% no adjustments, compatibility, scale without hiring).`);
  lines.push(`- CTA: one low-commitment question.`);
  lines.push(`- No bullet points, no bold.`);
  lines.push(`- Sign-off optional ("— Team weCAD4you" is fine).`);
  lines.push(``);
  lines.push(`Respond with the JSON object only, no prose around it.`);
  return lines.join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip ```json fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(body);
}

function clampIcebreaker(text: string, firstName: string | null): string {
  let t = text.trim();
  // Defensiva: si Claude igual incluyó "Hi <name>," al inicio, lo sacamos.
  const greetRegex = new RegExp(`^hi\\s+${(firstName ?? "").trim()}[,\\s].*?,\\s*`, "i");
  t = t.replace(greetRegex, "").trim();
  // Genérico: "Hi <anything>," al principio
  t = t.replace(/^hi\s+[^,]{1,40},\s*/i, "").trim();
  // Sin saltos de línea
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 180) t = t.slice(0, 180).trim();
  return t;
}

export async function generateMessages(input: MessageInput): Promise<GeneratedMessages> {
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }]
  });

  const block = message.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned no text block");
  }
  const parsed = extractJson(block.text) as {
    linkedin_icebreaker?: string;
    email_subject?: string;
    email_body?: string;
  };

  if (!parsed.linkedin_icebreaker || !parsed.email_subject || !parsed.email_body) {
    throw new Error("Claude response missing one of icebreaker/subject/body");
  }

  return {
    linkedin_icebreaker: clampIcebreaker(parsed.linkedin_icebreaker, input.first_name),
    email_subject: parsed.email_subject.trim(),
    email_body: parsed.email_body.trim(),
    model_used
  };
}
