// Endpoint diagnóstico — NO inserta nada en la DB.
//
// Corre el mismo Perplexity + Claude que /api/companies/research-one para una
// empresa puntual, y devuelve TODO crudo: el contenido completo de Perplexity,
// la respuesta completa de Claude, las citas y los matches de palabras clave
// dentro del texto de Perplexity. Sirve para auditar de dónde salió una señal
// específica en fit_signals (caso Elite Dental Lab / "contratando CAM operator").
//
// Usa exactamente los mismos prompts que prod (lib/companyResearch.ts) para
// reproducir lo que vio el sistema en su momento.

import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";
import { perplexitySearch } from "@/lib/perplexity";
import { createMessageWithFallback } from "@/lib/claude";
import {
  SYSTEM_RESEARCH_ONE,
  buildResearchPrompt,
  renderIcpBrief,
  type CompanyHints
} from "@/lib/companyResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Match = { keyword: string; count: number; snippets: string[] };

// Busca todas las apariciones (case-insensitive) de cada keyword en text y
// devuelve hasta 5 fragmentos de ±120 chars de contexto alrededor de cada hit.
function findMatches(text: string, keywords: string[]): Match[] {
  const out: Match[] = [];
  for (const kw of keywords) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const snippets: string[] = [];
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (snippets.length < 5) {
        const start = Math.max(0, m.index - 120);
        const end = Math.min(text.length, m.index + m[0].length + 120);
        const snippet =
          (start > 0 ? "…" : "") +
          text.slice(start, end).replace(/\s+/g, " ").trim() +
          (end < text.length ? "…" : "");
        snippets.push(snippet);
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    out.push({ keyword: kw, count, snippets });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<CompanyHints> & {
    keywords?: string[];
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Falta el nombre de la empresa" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: icp, error: icpErr } = await db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (icpErr) return NextResponse.json({ error: icpErr.message }, { status: 500 });
  if (!icp) return NextResponse.json({ error: "No active ICP configured" }, { status: 400 });

  const hints: CompanyHints = {
    name,
    linkedin_url: body.linkedin_url ?? null,
    website: body.website ?? null,
    city: body.city ?? null,
    country: body.country ?? null
  };

  // 1) Perplexity — mismo system + user que prod
  let perplexity;
  try {
    perplexity = await perplexitySearch({
      system:
        "Eres un asistente de research B2B. Investigá la empresa puntual que te piden con evidencia pública verificable. Citá fuentes. Sé preciso sobre qué tipo de empresa es realmente.",
      user: buildResearchPrompt(hints)
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Perplexity failed", stage: "perplexity" },
      { status: 500 }
    );
  }

  // 2) Claude — mismo system + user que prod
  let claudeText = "";
  let claudeModel = "";
  let claudeErr: string | null = null;
  try {
    const { message, model_used } = await createMessageWithFallback({
      max_tokens: 4096,
      system: [
        { type: "text", text: SYSTEM_RESEARCH_ONE },
        { type: "text", text: renderIcpBrief(icp as IcpConfig), cache_control: { type: "ephemeral" } }
      ],
      messages: [
        {
          role: "user",
          content: `Empresa pedida por el usuario: "${hints.name}"
${hints.linkedin_url ? `LinkedIn dado: ${hints.linkedin_url}\n` : ""}${hints.website ? `Sitio dado: ${hints.website}\n` : ""}
Investigación de Perplexity (con citas [1], [2], ...):

${perplexity.content}

---

Devolvé el JSON estricto definido en el sistema para ESTA empresa.`
        }
      ]
    });
    claudeText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    claudeModel = model_used;
  } catch (err) {
    claudeErr = err instanceof Error ? err.message : "Claude failed";
  }

  // 3) Matches de palabras clave en el texto crudo de Perplexity. Por default
  // buscamos lo que típicamente alimenta señales operativas (hiring,
  // externalización, software). El caller puede pasar `keywords` para sumar
  // términos específicos del caso (ej. "CAM operator", "Elite Dental").
  const defaultKeywords = [
    name,
    "hiring",
    "hire",
    "contratando",
    "contrata",
    "CAM operator",
    "CAM",
    "outsource",
    "externaliza",
    "exocad",
    "inLab",
    "3Shape",
    "Evident",
    "Full Contour",
    "Aidite"
  ];
  const keywords = Array.from(
    new Set([...(body.keywords ?? []), ...defaultKeywords].filter((k) => k && k.trim().length > 0))
  );
  const matches_in_perplexity = findMatches(perplexity.content, keywords);

  return NextResponse.json({
    hints,
    perplexity: {
      content_chars: perplexity.content.length,
      content_full: perplexity.content,
      citations: perplexity.citations
    },
    claude: {
      model_used: claudeModel,
      response_chars: claudeText.length,
      response_full: claudeText,
      error: claudeErr
    },
    matches_in_perplexity
  });
}
