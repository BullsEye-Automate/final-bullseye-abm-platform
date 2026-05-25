import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const META_PROMPT = `You are a B2B prospecting expert specializing in Clay workflows.

Based on the following ICP (Ideal Customer Profile), extract and generate 3 configurations for Clay's Find People feature.

Return ONLY a valid JSON object with exactly these 3 keys — no markdown, no code fences, no explanation:
{
  "find_people_titles": "...",
  "find_people_keywords": "...",
  "excluded_titles": "..."
}

Rules for "find_people_titles":
- Include ALL decision-maker AND influencer job titles from the ICP
- Translate to English if written in Spanish
- Comma-separated, no period at the end
- Maximum 20 titles (Clay has character limits)
- Example: "CEO, Founder, Co-founder, VP Sales, VP Marketing, Head of Sales, Head of Marketing, Sales Director, Country Manager, General Manager, Chief Revenue Officer, Chief Commercial Officer"

Rules for "find_people_keywords":
- Generate 5-8 additional keywords that complement the titles for Find People
- Relevant to the ICP's industry and buyer profile
- Comma-separated
- Example: "sales, growth, revenue, commercial, business development"

Rules for "excluded_titles":
- Extract job titles to avoid from the ICP (no buying power or block the process)
- Translate to English if in Spanish
- Comma-separated
- Example: "intern, assistant, coordinator, trainee, IT, developer, accountant, student"

ICP:
`;

// GET — devuelve los valores guardados (si existen)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .select("clay_find_people_titles, clay_find_people_keywords, clay_excluded_titles")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    find_people_titles:  data?.clay_find_people_titles  ?? null,
    find_people_keywords: data?.clay_find_people_keywords ?? null,
    excluded_titles:     data?.clay_excluded_titles     ?? null,
  });
}

// POST — genera (o regenera) los valores y los guarda
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
    max_tokens: 800,
    messages: [
      { role: "user", content: META_PROMPT + icpCtx.content }
    ]
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  let parsed: { find_people_titles: string; find_people_keywords: string; excluded_titles: string };
  try {
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return NextResponse.json(
      { error: "La respuesta de Claude no era JSON válido. Intenta de nuevo." },
      { status: 500 }
    );
  }

  const { error: saveErr } = await db
    .from("clients")
    .update({
      clay_find_people_titles:  parsed.find_people_titles  ?? null,
      clay_find_people_keywords: parsed.find_people_keywords ?? null,
      clay_excluded_titles:     parsed.excluded_titles     ?? null,
    })
    .eq("id", params.id);

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({
    find_people_titles:  parsed.find_people_titles,
    find_people_keywords: parsed.find_people_keywords,
    excluded_titles:     parsed.excluded_titles,
  });
}
