import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LINKEDIN_INVITE_MAX_CHARS = 200;

type CampaignTexts = {
  emailSubject: string;
  emailBody: string;
  emailFollowUp: string;
  emailFollowUp2: string;
  breakupEmail: string;
  linkedinInvite: string;
  linkedinIcebreaker: string;
  linkedinIcebreakerNoEmail: string;
};

function detectLanguage(content: string): "en" | "es" {
  const englishMarkers =
    /\b(united states|usa|u\.s\.a\.?|united kingdom|u\.k\.?|canada|australia|new zealand)\b/i;
  return englishMarkers.test(content) ? "en" : "es";
}

function buildPrompt(icpContext: string, language: "en" | "es"): string {
  const isEn = language === "en";
  const greeting = isEn ? "Hi {{firstName}}," : "Hola {{firstName}},";
  const langNote = isEn
    ? "Write ALL texts in English."
    : "Escribe TODOS los textos en español latinoamericano neutro.";

  return `${langNote}

You are a B2B outbound copywriting expert. Based on the ICP below, generate all texts for a Lemlist campaign sequence.

ICP Context:
${icpContext}

Generate these 7 texts:

1. emailSubject — Initial email subject (max 7 words, no exclamation marks, no emojis, intriguing and specific)
2. emailBody — Initial email body. MUST start exactly with "${greeting}\\n\\n" then the message. Max 5 sentences. No bullets. End with a soft question or CTA.
3. emailFollowUp — Follow-up email sent when LinkedIn invite is NOT accepted (3 days later). Short reference to initial email. Max 3 sentences.
4. emailFollowUp2 — Second follow-up email (5 days after follow-up). Very concise, 2-3 sentences.
5. breakupEmail — Final breakup email. Max 2 sentences. Professional, gives an easy out.
6. linkedinInvite — Note attached to the LinkedIn connection request (STRICT MAXIMUM 200 characters). No greeting, no emoji, no long dashes. Brief and compelling reason to connect.
7. linkedinIcebreaker — LinkedIn chat message when invite IS accepted. Max 180 characters. No greeting, no emoji, directly references why they're a fit.
8. linkedinIcebreakerNoEmail — LinkedIn chat message for contacts WITHOUT email (end of no-email sequence). Max 180 characters. No greeting, no emoji.

Respond ONLY with valid JSON, no extra text:
{
  "emailSubject": "...",
  "emailBody": "...",
  "emailFollowUp": "...",
  "emailFollowUp2": "...",
  "breakupEmail": "...",
  "linkedinInvite": "...",
  "linkedinIcebreaker": "...",
  "linkedinIcebreakerNoEmail": "..."
}`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", params.id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!icpCtx?.content?.trim()) {
    return NextResponse.json(
      { error: "El cliente no tiene ICP configurado. Súbelo en el Paso 2." },
      { status: 400 }
    );
  }

  const language = detectLanguage(icpCtx.content);
  const prompt = buildPrompt(icpCtx.content, language);

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "No se pudo parsear la respuesta de Claude" },
      { status: 500 }
    );
  }

  const texts = JSON.parse(jsonMatch[0]) as CampaignTexts;

  // Garantizar límite estricto de LinkedIn para invitaciones a conectar
  if (texts.linkedinInvite?.length > LINKEDIN_INVITE_MAX_CHARS) {
    texts.linkedinInvite = texts.linkedinInvite.slice(0, LINKEDIN_INVITE_MAX_CHARS).trimEnd();
  }

  return NextResponse.json({ texts, language });
}
