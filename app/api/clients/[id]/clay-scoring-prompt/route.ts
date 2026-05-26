import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const META_PROMPT = `You are a B2B prospecting expert specializing in Clay workflows and AI lead scoring.

Based on the following ICP and Buyer Persona, generate an optimized prompt for a Clay Lead Scoring AI column.

The generated prompt must:
1. Describe in 2-3 sentences the ideal company profile AND the ideal contact profile
2. List the top positive fit criteria (max 5), ordered by importance
3. List the disqualification criteria (max 3)
4. Specify that the response must be ONLY a JSON object with this exact format:
   {"fit_score": number 1-10, "fit": "high"|"medium"|"low", "fit_reason": "brief explanation in Spanish", "fit_action": "enrich" if score>=7 | "manual_review" if score 4-6 | "discard" if score<=3}
5. Be written entirely in English (Clay AI performs better in English)
6. Be specific, actionable, and avoid generic language
7. Reference the actual industry, company size, job titles, and signals from the ICP
8. Do NOT include a "CONTACT DATA TO EVALUATE" section — that will be appended automatically

The prompt should be ready to paste directly into a Clay AI column formula. Start the prompt directly — no preamble, no "Here is the prompt:" header.

ICP and Buyer Persona:
`;

// Bloque fijo de chips de Clay que siempre se añade al final del prompt generado.
// Clay sustituye estos {{campos}} con los datos reales de cada contacto al ejecutar la columna.
// Solo incluye campos que la app envía realmente vía webhook (clayPushContact.ts).
// {{company_type}} y {{country}} se omiten — no están en el payload y Clay los
// pasaba como texto literal al AI, rompiendo el score.
const CLAY_CHIPS_BLOCK = `

**CONTACT DATA TO EVALUATE:**
- First Name: {{first_name}}
- Last Name: {{last_name}}
- Job Title: {{job_title}}
- LinkedIn URL: {{linkedin_url}}
- Company Name: {{company_name}}
- Company Size: {{company_size}}
- Fit Signals: {{fit_signals}}  (company-level signals: industry, growth indicators, size context, and ICP alignment signals pre-validated by BullsEye)`;

// GET — devuelve el prompt guardado (si existe)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .select("clay_scoring_prompt")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompt: data?.clay_scoring_prompt ?? null });
}

// POST — genera (o regenera) el prompt y lo guarda
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
      { error: "Este cliente no tiene ICP configurado. Configúralo primero en SISTEMA → ICP." },
      { status: 400 }
    );
  }

  const message = await anthropic().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 1500,
    messages: [
      {
        role:    "user",
        content: META_PROMPT + icpCtx.content
      }
    ]
  });

  const generatedText = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Siempre añadimos el bloque de chips al final; Clay los reemplaza con datos reales.
  const prompt = generatedText + CLAY_CHIPS_BLOCK;

  const { error: saveErr } = await db
    .from("clients")
    .update({ clay_scoring_prompt: prompt })
    .eq("id", params.id);

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ prompt });
}
