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
import { supabaseAdmin } from "./supabase";
import {
  type ModelTrainingConfig,
  configHasContent,
  loadActiveModelTrainingConfig,
  renderConfigInstructions
} from "./modelTrainingConfig";

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

function buildUserPrompt(
  input: MessageInput,
  config: ModelTrainingConfig | null
): string {
  const fullName = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();
  const hasOperationalCompanyData =
    Boolean(input.cad_software) ||
    Boolean(input.scanner_technology) ||
    Boolean(input.fit_signals && input.fit_signals.trim().length > 0);
  const hasPersonSignal = Boolean(input.linkedin_headline) || Boolean(input.job_title);

  const lines: string[] = [];
  // Si hay config del equipo, la inyectamos al inicio. Esto le da
  // precedencia sobre los defaults hardcoded de abajo cuando hay
  // conflictos. Si no hay config (o todos los campos vacíos), salta
  // este bloque y el comportamiento es idéntico al original.
  const configBlock = renderConfigInstructions(config, input.job_title, input.company_type);
  if (configBlock) {
    lines.push(configBlock.trim());
    lines.push("");
    lines.push("───");
    lines.push("");
  }
  lines.push(`PROSPECT (the person you're writing to):`);
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
  else lines.push(`- CAD software: (no public information)`);
  if (input.scanner_technology) lines.push(`- Scanner technology: ${input.scanner_technology}`);
  else lines.push(`- Scanner technology: (no public information)`);
  if (input.fit_signals && input.fit_signals.trim().length > 0) {
    lines.push(`- Fit signals: ${input.fit_signals}`);
  } else {
    lines.push(`- Fit signals: (no specific operational signals confirmed)`);
  }
  lines.push(``);
  lines.push(`DATA QUALITY: ${
    hasOperationalCompanyData
      ? "company has confirmed operational data above"
      : "company has NO confirmed operational data (anchor outreach on the person's role / LinkedIn headline instead)"
  }`);
  lines.push(``);
  lines.push(`Generate three pieces of outreach. Return STRICT JSON only with this shape:`);
  lines.push(`{`);
  lines.push(`  "linkedin_icebreaker": "<single line, MAX 180 characters, NO greeting>",`);
  lines.push(`  "email_subject": "<MAX 7 words>",`);
  lines.push(`  "email_body": "<starts with 'Hi {firstName},' newline, then body>"`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`ABSOLUTE RULES (apply to ALL three outputs — non-negotiable):`);
  lines.push(`1. ZERO INVENTION. Reference ONLY facts that appear LITERALLY in the data above. Do NOT extrapolate, infer or imagine anything about the company or the person.`);
  lines.push(`2. FORBIDDEN if not literal in the data: hiring, growth, expansion, recent news, case studies, funding, partnerships, software, scanners, customer base, awards, certifications, products, services. None of these unless they appear verbatim above.`);
  lines.push(`3. The "Fit signals" field may contain citation markers like [2]. Those are evidence pointers. DO NOT reproduce them in your output.`);
  lines.push(`4. If a field above says "(no public information)" or "(no specific operational signals confirmed)", treat that data point as UNKNOWN. Do not pretend to know it. Do not phrase anything in a way that implies you know it.`);
  lines.push(`5. Inventing data is the worst thing you can do. We would rather send a clean, role-aware opener with NO company-specific claims than a fabricated one. A fabricated icebreaker BURNS the prospect.`);
  lines.push(``);
  lines.push(`PERSONALIZATION HIERARCHY (use in this strict order, stop at first that applies):`);
  lines.push(`A. If "Fit signals" contains an OPERATIONAL fact about this company (specific software mentioned, scanner mentioned, competitor relationship, public hiring activity, public case study), reference exactly that fact.`);
  lines.push(`B. Else if CAD software OR Scanner technology is set (not "(no public information)"), reference exactly that.`);
  lines.push(`C. Else if LinkedIn headline contains a substantive statement (a focus, a passion, a tagline beyond just the job title), reference exactly what they say in their own headline.`);
  lines.push(`D. Else (no specific company info, no person-specific signals): anchor on the prospect's ROLE + COMPANY TYPE only. The opener should highlight a value proposition of weCAD4you that is RELEVANT to people in that role at that company type, without claiming anything about THIS specific company. The framing should feel like an observation about labs of their type, not an assertion about them. Examples (adapt to the role):`);
  lines.push(`   - To a Lab Manager / Owner at a small lab: "Most lab owners I talk to are surprised that outsourcing CAD design with 24h turnaround actually costs less than hiring a designer. Worth a quick look?"`);
  lines.push(`   - To a Production / Operations Manager: "Curious how your team handles CAD overflow when scan volume spikes. Most labs your size are weighing in-house designers vs outsourcing."`);
  lines.push(`   - To a CAD Technician / Designer: "Mostly reaching out to CAD folks at labs running exocad or inLab to see how they handle overflow. Open to a quick chat?"`);
  lines.push(`   - To an Owner / Founder: "Most lab owners we work with were stuck choosing between turning down cases or hiring designers. We design crowns and bridges in 24h in exocad and inLab — no hire needed."`);
  lines.push(`   Notes for D:`);
  lines.push(`   - Lead with a relevant value prop of weCAD4you (24h turnaround, exocad/inLab specialty, 98.9% no-adjustment rate, scanner-agnostic, scale without hiring designers).`);
  lines.push(`   - Frame as an observation about labs of their type — NOT as a claim about THIS company specifically.`);
  lines.push(`   - Always end with a low-commitment open question.`);
  lines.push(``);
  lines.push(`RULES for linkedin_icebreaker:`);
  lines.push(`- MAX 180 characters total (counted strictly).`);
  lines.push(`- NEVER include "Hi ${input.first_name ?? "{firstName}"}, " or any greeting. Start with substantive content directly.`);
  lines.push(`- Apply the personalization hierarchy above.`);
  lines.push(`- Tone: dental industry peer, never salesy or generic.`);
  lines.push(`- End with a low-commitment question.`);
  lines.push(`- NO links, NO emojis, NO line breaks.`);
  lines.push(`- DO NOT use em-dash (—), en-dash (–) or hyphen (-) as a separator.`);
  lines.push(``);
  lines.push(`RULES for email_subject:`);
  lines.push(`- MAX 7 words.`);
  lines.push(`- ${hasOperationalCompanyData ? "Specific to them (mention company name, software, or confirmed signal)." : "Anchor on the prospect's role or a generic question relevant to dental labs — NOT a specific software/scanner the company doesn't confirm using."}`);
  lines.push(`- No clickbait, no caps lock, no emojis.`);
  lines.push(`- DO NOT use em-dash (—) or en-dash (–). Use a colon (:) if you need a break.`);
  lines.push(``);
  lines.push(`RULES for email_body:`);
  lines.push(`- Start with "Hi ${input.first_name ?? "there"},\\n\\n".`);
  lines.push(`- Line 1: opener applying the personalization hierarchy. ${hasOperationalCompanyData ? "Use the confirmed fact." : "Anchor on their role + LinkedIn headline if available, or a generic industry observation. NO claims about software/scanner/hiring/case studies you don't have in the data."}`);
  lines.push(`- Line 2: what weCAD4you does in one sentence.`);
  lines.push(`- Line 3: a concrete weCAD4you result (24h turnaround, 98.9% no adjustments, scanner-agnostic compatibility, scale without hiring designers).`);
  lines.push(`- CTA: one low-commitment question.`);
  lines.push(`- No bullet points, no bold.`);
  lines.push(`- DO NOT use em-dash (—), en-dash (–) or hyphen (-) as a separator.`);
  lines.push(`- DO NOT add any sign-off ("— Team weCAD4you", "Best,", "Saludos,", "Cheers,", etc.). Lemlist appends the signature automatically.`);
  lines.push(`- The email body must END with the CTA question. Nothing after it.`);
  lines.push(``);
  if (!hasOperationalCompanyData && hasPersonSignal) {
    lines.push(`REMINDER: This company has NO confirmed operational data. Do NOT invent software, scanners, hiring, growth, externalization, or any specific company fact. Your safest hook is the prospect's role and (if available) their LinkedIn headline.`);
    lines.push(``);
  } else if (!hasOperationalCompanyData && !hasPersonSignal) {
    lines.push(`REMINDER: Neither the company NOR the prospect have specific signals. Default to a clean, honest opener referencing their role + company type only. NO fabrication.`);
    lines.push(``);
  }
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

// Reemplaza em-dash (—) y en-dash (–) por puntos/comas según contexto.
// Hyphen (-) entre letras lo dejamos (palabras compuestas como "follow-up").
// Si el hyphen está rodeado de espacios (" - "), lo tratamos como separador.
// Exportado: lib/replyDrafter.ts lo reusa para los borradores de respuesta.
export function stripAiDashes(text: string): string {
  let t = text;
  // Em/en dash con espacios alrededor → coma + espacio
  t = t.replace(/\s*[—–]\s*/g, ", ");
  // Hyphen con espacios alrededor → coma + espacio
  t = t.replace(/(\s)-(\s)/g, ", ");
  // Si quedó ", , " por concatenación, colapsar
  t = t.replace(/,\s*,/g, ",");
  return t;
}

// Saca cualquier sign-off típico al final del email body (Lemlist agrega el suyo).
// Exportado: lib/replyDrafter.ts lo reusa para los borradores de respuesta por email.
export function stripSignature(text: string): string {
  let t = text.trim();
  // Patrones comunes — siempre al final. Recortamos desde el inicio del
  // signoff hasta el final del string.
  const patterns: RegExp[] = [
    /\n+\s*[—–-]\s*Team\s+weCAD4you[\s\S]*$/i,
    /\n+\s*Team\s+weCAD4you[\s\S]*$/i,
    /\n+\s*(Best|Best regards|Cheers|Thanks|Thank you|Saludos|Atentamente|Cordialmente|Regards|Sincerely)[,\.\s][\s\S]*$/i,
    /\n+\s*[—–-]\s*\w+[\s\S]*$/  // Cualquier línea final que arranque con dash + nombre
  ];
  for (const p of patterns) {
    t = t.replace(p, "").trim();
  }
  return t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strippea citation markers tipo [2] o [12] que pudieran haber sobrevivido
// del fit_signals (a pesar de la instrucción en el prompt). En output al
// prospecto no deben aparecer NUNCA.
function stripCitationMarkers(text: string): string {
  return text.replace(/\s*\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
}

function clampIcebreaker(text: string, firstName: string | null): string {
  let t = text.trim().replace(/\s+/g, " ");
  // Sacar citation markers + dashes "AI-generated"
  t = stripCitationMarkers(t);
  t = stripAiDashes(t);
  // Defensiva: si Claude igual incluyó "Hi <name>," al inicio, lo sacamos —
  // pero SOLO si queda contenido sustantivo después. Si Claude devolvió puro
  // saludo ("Hi Nick,"), preferimos mandar eso antes que un string vacío,
  // que en Lemlist sale como "{{icebreaker}} has no value".
  const name = escapeRegex((firstName ?? "").trim());
  let stripped = t;
  if (name) {
    stripped = stripped.replace(new RegExp(`^hi\\s+${name}[,\\s].*?,\\s*`, "i"), "").trim();
  }
  // Genérico: "Hi <anything>," al principio
  stripped = stripped.replace(/^hi\s+[^,]{1,40},\s*/i, "").trim();
  if (stripped.length > 0) t = stripped;
  if (t.length > 180) t = t.slice(0, 180).trim();
  return t.trim();
}

function sanitizeSubject(text: string): string {
  return stripAiDashes(stripCitationMarkers(text.trim()));
}

function sanitizeBody(text: string): string {
  // Orden: primero sign-off (que puede contener dashes), después dashes, después citations.
  let t = stripSignature(text);
  t = stripAiDashes(t);
  t = stripCitationMarkers(t);
  return t.trim();
}

// Strippea frases prohibidas (case-insensitive). Si la frase aparece
// dentro de un texto más largo, la reemplaza por su versión maskeada
// para que sea evidente en el output. Si el sanitizer rompe demasiado
// (>40% del texto), preferimos dejarlo pasar para que el caller pueda
// reintentar — vacío es peor que con una palabra prohibida.
function stripForbiddenPhrases(text: string, phrases: string[]): string {
  if (phrases.length === 0) return text;
  let out = text;
  for (const p of phrases) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const re = new RegExp(escapeRegex(trimmed), "gi");
    out = out.replace(re, "");
  }
  // Limpiamos doble espacios / signos huérfanos.
  out = out.replace(/\s{2,}/g, " ").replace(/\s*([.,;])\s*/g, "$1 ").trim();
  return out.length < text.length * 0.6 ? text : out;
}

export async function generateMessages(
  input: MessageInput,
  config: ModelTrainingConfig | null = null
): Promise<GeneratedMessages> {
  // Auto-cargar config si no se pasó. Mantiene a los callers ignorantes
  // de que existe — si la tabla está vacía o no tiene contenido,
  // loadActiveModelTrainingConfig devuelve null y el comportamiento es
  // idéntico al anterior. Best-effort: si la DB falla, seguimos sin config.
  let activeConfig = config;
  if (activeConfig === null) {
    try {
      activeConfig = await loadActiveModelTrainingConfig(supabaseAdmin());
    } catch {
      activeConfig = null;
    }
  }

  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input, activeConfig) }]
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

  // Lista de palabras a strippear: las que dejó la config. Si la config
  // está vacía, este array queda vacío y stripForbiddenPhrases es no-op.
  const forbidden = configHasContent(activeConfig) ? activeConfig!.forbidden_phrases : [];

  const result: GeneratedMessages = {
    linkedin_icebreaker: stripForbiddenPhrases(
      clampIcebreaker(parsed.linkedin_icebreaker, input.first_name),
      forbidden
    ),
    email_subject: stripForbiddenPhrases(sanitizeSubject(parsed.email_subject), forbidden),
    email_body: stripForbiddenPhrases(sanitizeBody(parsed.email_body), forbidden),
    model_used
  };

  // Los sanitizers (clamp / strip dash / strip signature) pueden vaciar un
  // campo si Claude devolvió algo degenerado. Validamos el resultado FINAL,
  // no el parseado — un campo vacío acá termina como "{{variable}} has no
  // value" en Lemlist. Mejor fallar y que el caller decida (reintentar).
  if (
    !result.linkedin_icebreaker.trim() ||
    !result.email_subject.trim() ||
    !result.email_body.trim()
  ) {
    throw new Error(
      "El mensaje generado quedó vacío después de sanitizar (icebreaker/subject/body)"
    );
  }

  return result;
}
