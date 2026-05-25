import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const META_PROMPT = `You are a B2B prospecting expert specializing in Clay workflows.

Based on the following ICP (Ideal Customer Profile), extract and generate 4 configurations for Clay's Find People feature.

Return ONLY a valid JSON object with exactly these 4 keys — no markdown, no code fences, no explanation:
{
  "find_people_titles": "...",
  "find_people_keywords": "...",
  "excluded_titles": "...",
  "location_filter": "..."
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

Rules for "location_filter":
- Extract target geographies from the ICP and format them for Clay's Location filter
- Include countries AND major cities if the ICP specifies them
- All names must be in English, as Clay recognizes them
- Comma-separated
- If the ICP mentions "LATAM" or "Latin America" → expand to: Chile, Colombia, Mexico, Argentina, Peru, Uruguay
- If the ICP mentions "USA" or "Estados Unidos" → use "United States"
- If the ICP mentions "España" → use "Spain"
- Example: "Chile, Colombia, Mexico, Argentina, Peru, Miami, New York"

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
    .select("clay_find_people_titles, clay_find_people_keywords, clay_excluded_titles, clay_location_filter")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    find_people_titles:   data?.clay_find_people_titles   ?? null,
    find_people_keywords: data?.clay_find_people_keywords ?? null,
    excluded_titles:      data?.clay_excluded_titles      ?? null,
    location_filter:      data?.clay_location_filter      ?? null,
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

  let parsed: { find_people_titles: string; find_people_keywords: string; excluded_titles: string; location_filter: string };
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
      clay_location_filter:     parsed.location_filter     ?? null,
    })
    .eq("id", params.id);

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({
    find_people_titles:   parsed.find_people_titles,
    find_people_keywords: parsed.find_people_keywords,
    excluded_titles:      parsed.excluded_titles,
    location_filter:      parsed.location_filter,
  });
}
