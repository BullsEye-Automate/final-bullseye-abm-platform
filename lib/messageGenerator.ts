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
  tool_primary: string | null;
  tool_secondary: string | null;
  fit_signals: string | null;
};

export type GeneratedMessages = {
  linkedin_icebreaker: string;
  email_subject: string;
  email_body: string;
  model_used: string;
};

function buildSystemPrompt(config: ModelTrainingConfig | null): string {
  const lines: string[] = [];
  if (config?.business_name && config?.business_description) {
    lines.push(`You are an SDR for ${config.business_name}. ${config.business_description}`);
  } else if (config?.business_description) {
    lines.push(`You are an SDR. ${config.business_description}`);
  } else {
    lines.push(`You are a B2B SDR writing outbound outreach to one prospect at a time.`);
  }
  if (config?.target_buyer_persona) {
    lines.push(``);
    lines.push(`Target buyer persona: ${config.target_buyer_persona}`);
  }
  if (config && config.value_props.length > 0) {
    lines.push(``);
    lines.push(`Value propositions (priority order):`);
    config.value_props.forEach((v, i) => lines.push(`  ${i + 1}. ${v}`));
  }
  lines.push(``);
  lines.push(`You write outreach for ONE prospect at a time. Output JSON only.`);
  return lines.join("\n");
}

function buildUserPrompt(input: MessageInput, config: ModelTrainingConfig | null): string {
  const fullName = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();
  const hasOperationalCompanyData =
    Boolean(input.tool_primary) ||
    Boolean(input.tool_secondary) ||
    Boolean(input.fit_signals && input.fit_signals.trim().length > 0);

  const lines: string[] = [];
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
  lines.push(`- Primary tooling: ${input.tool_primary ?? "(no public information)"}`);
  lines.push(`- Secondary tooling: ${input.tool_secondary ?? "(no public information)"}`);
  if (input.fit_signals && input.fit_signals.trim().length > 0) {
    lines.push(`- Fit signals: ${input.fit_signals}`);
  } else {
    lines.push(`- Fit signals: (no specific operational signals confirmed)`);
  }
  lines.push(``);
  lines.push(`DATA QUALITY: ${hasOperationalCompanyData ? "company has confirmed operational data above" : "company has NO confirmed operational data (anchor outreach on the person's role / LinkedIn headline instead)"}`);
  lines.push(``);
  lines.push(`Generate three pieces of outreach. Return STRICT JSON only with this shape:`);
  lines.push(`{"linkedin_icebreaker":"<single line, MAX 180 characters, NO greeting>","email_subject":"<MAX 7 words>","email_body":"<starts with 'Hi ${input.first_name ?? "{firstName}"},\\n\\n', then body>"}`);
  lines.push(``);
  lines.push(`ABSOLUTE RULES:`);
  lines.push(`1. ZERO INVENTION. Reference ONLY facts that appear LITERALLY in the data above.`);
  lines.push(`2. FORBIDDEN if not literal in the data: hiring, growth, expansion, recent news, case studies, funding, partnerships, tools/software, customer base, awards, certifications, products, services.`);
  lines.push(`3. Citation markers like [2] in fit_signals are evidence pointers — do NOT reproduce them.`);
  lines.push(`4. If a field says "(no public information)" or "(no specific operational signals confirmed)", treat it as UNKNOWN.`);
  lines.push(`5. DO NOT use em-dash (—), en-dash (–), or hyphen (-) as a separator.`);
  lines.push(`6. DO NOT add any sign-off ("Best,", "Saludos,", etc.) — Lemlist appends the signature automatically.`);
  lines.push(``);
  lines.push(`PERSONALIZATION HIERARCHY (use in strict order):`);
  lines.push(`A. If "Fit signals" has a SPECIFIC confirmed operational fact about THIS company, reference exactly that.`);
  lines.push(`B. Else if "Primary tooling" OR "Secondary tooling" is set (not "(no public information)"), reference it exactly.`);
  lines.push(`C. Else if LinkedIn headline has a substantive statement beyond job title, reference it.`);
  lines.push(`D. Else anchor on the prospect's ROLE + COMPANY TYPE only, with a value proposition from config, no claims about THIS company.`);
  lines.push(``);
  lines.push(`RULES for linkedin_icebreaker: MAX 180 chars. NEVER include "Hi ${input.first_name ?? "{firstName}"},". Industry peer tone. End with low-commitment question. No links, no emojis, no line breaks.`);
  lines.push(`RULES for email_subject: MAX 7 words. Specific if data exists, role-anchored if not. No clickbait, no emojis.`);
  lines.push(`RULES for email_body: Start with "Hi ${input.first_name ?? "there"},\\n\\n". Line 1: opener per hierarchy. Line 2: what we do. Line 3: proof point. CTA: one low-commitment question. No bullets, no bold. End with the CTA question. Nothing after it.`);
  if (!hasOperationalCompanyData) {
    lines.push(``);
    lines.push(`REMINDER: This company has NO confirmed operational data. Do NOT invent tooling, hiring, growth, or any specific company fact.`);
  }
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

export function stripAiDashes(text: string): string {
  let t = text;
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(/(\s)-(\s)/g, ", ");
  t = t.replace(/,\s*,/g, ",");
  return t;
}

export function stripSignature(text: string): string {
  let t = text.trim();
  const patterns: RegExp[] = [
    /\n+\s*(Best|Best regards|Cheers|Thanks|Thank you|Saludos|Atentamente|Cordialmente|Regards|Sincerely)[,\.\s][\s\S]*$/i,
    /\n+\s*[—–-]\s*\w+[\s\S]*$/
  ];
  for (const p of patterns) {
    t = t.replace(p, "").trim();
  }
  return t;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCitationMarkers(text: string): string {
  return text.replace(/\s*\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
}

function clampIcebreaker(text: string, firstName: string | null, maxChars = 180): string {
  let t = text.trim().replace(/\s+/g, " ");
  t = stripCitationMarkers(t);
  t = stripAiDashes(t);
  const name = escapeRegex((firstName ?? "").trim());
  let stripped = t;
  if (name) {
    stripped = stripped.replace(new RegExp(`^hi\\s+${name}[,\\s].*?,\\s*`, "i"), "").trim();
  }
  stripped = stripped.replace(/^hi\s+[^,]{1,40},\s*/i, "").trim();
  if (stripped.length > 0) t = stripped;
  if (t.length > maxChars) t = t.slice(0, maxChars).trim();
  return t.trim();
}

function sanitizeSubject(text: string): string {
  return stripAiDashes(stripCitationMarkers(text.trim()));
}

function sanitizeBody(text: string): string {
  let t = stripSignature(text);
  t = stripAiDashes(t);
  t = stripCitationMarkers(t);
  return t.trim();
}

function stripForbiddenPhrases(text: string, phrases: string[]): string {
  if (phrases.length === 0) return text;
  let out = text;
  for (const p of phrases) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const re = new RegExp(escapeRegex(trimmed), "gi");
    out = out.replace(re, "");
  }
  out = out.replace(/\s{2,}/g, " ").replace(/\s*([.,;])\s*/g, "$1 ").trim();
  return out.length < text.length * 0.6 ? text : out;
}

export async function generateMessages(
  input: MessageInput,
  config: ModelTrainingConfig | null = null
): Promise<GeneratedMessages> {
  let activeConfig = config;
  if (activeConfig === null) {
    try {
      activeConfig = await loadActiveModelTrainingConfig(supabaseAdmin());
    } catch {
      activeConfig = null;
    }
  }

  const systemPrompt = buildSystemPrompt(activeConfig);
  const userPrompt = buildUserPrompt(input, activeConfig);

  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const block = message.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude returned no text block");

  const parsed = extractJson(block.text) as {
    linkedin_icebreaker?: string;
    email_subject?: string;
    email_body?: string;
  };

  if (!parsed.linkedin_icebreaker || !parsed.email_subject || !parsed.email_body) {
    throw new Error("Claude response missing one of icebreaker/subject/body");
  }

  const forbidden = configHasContent(activeConfig) ? activeConfig!.forbidden_phrases : [];
  const icebreakerMax = activeConfig?.icebreaker_max_chars ?? 180;

  const result: GeneratedMessages = {
    linkedin_icebreaker: stripForbiddenPhrases(
      clampIcebreaker(parsed.linkedin_icebreaker, input.first_name, icebreakerMax),
      forbidden
    ),
    email_subject: stripForbiddenPhrases(sanitizeSubject(parsed.email_subject), forbidden),
    email_body: stripForbiddenPhrases(sanitizeBody(parsed.email_body), forbidden),
    model_used
  };

  if (!result.linkedin_icebreaker.trim() || !result.email_subject.trim() || !result.email_body.trim()) {
    throw new Error("El mensaje generado quedó vacío después de sanitizar (icebreaker/subject/body)");
  }

  return result;
}
