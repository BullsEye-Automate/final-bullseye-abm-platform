import { NextRequest, NextResponse } from "next/server";
import { perplexitySearch } from "@/lib/perplexity";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { citationNamesCompany, evidenceQuality } from "@/lib/companyEvidence";
import { logAiUsage } from "@/lib/aiUsageLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_DIAGNOSTIC = `Eres analista de prospección B2B. A partir de la investigación web de una empresa específica, extrae sus datos estructurados.

IMPORTANTE: NO inventes datos. Usa ÚNICAMENTE la evidencia provista.

Devuelve SOLO JSON válido:
{
  "fit_signals": string | null,
  "research_summary": string | null,
  "company_city": string | null,
  "company_country": string | null,
  "company_size": number | null,
  "company_type": "other",
  "fit_score": "high" | "medium" | "low"
}

fit_signals: lista de señales de fit separadas por " · ". Si no hay evidencia de fit, null.
research_summary: 2-3 frases sobre la empresa y por qué podría calificar como prospecto.`;

type Hints = {
  linkedin_url?: string;
  website?: string;
  city?: string;
  country?: string;
};

type Body = {
  name: string;
  hints?: Hints;
  extra_keywords?: string[];
};

function countKeywordHits(text: string, keyword: string): { hits: number; snippets: string[] } {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const sentences = text.split(/[.!?\n]+/).filter(Boolean);
  const snippets = sentences
    .filter(s => s.toLowerCase().includes(kw))
    .slice(0, 3)
    .map(s => s.trim().slice(0, 120));
  return { hits: snippets.length, snippets };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "El campo 'name' es requerido" }, { status: 400 });
  }

  const name = body.name.trim();
  const hints = body.hints ?? {};
  const extraKeywords = body.extra_keywords ?? [];

  const hintParts: string[] = [];
  if (hints.city)         hintParts.push(`ciudad: ${hints.city}`);
  if (hints.country)      hintParts.push(`país: ${hints.country}`);
  if (hints.linkedin_url) hintParts.push(`LinkedIn: ${hints.linkedin_url}`);
  if (hints.website)      hintParts.push(`web: ${hints.website}`);
  const hintLine = hintParts.length > 0 ? ` (${hintParts.join(", ")})` : "";

  // Perplexity search
  const t0 = Date.now();
  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B. Busca información pública y verificable sobre la empresa indicada.",
    user: `Investiga detalladamente la empresa "${name}"${hintLine}. Encuentra: descripción del negocio, sector, tecnologías que usan, tamaño, ubicación, señales de crecimiento, clientes o socios conocidos, LinkedIn corporativo, sitio web.`
  }).catch(() => null);

  if (!research?.content) {
    return NextResponse.json({ error: "No se pudo investigar la empresa con Perplexity. Verificá la API key." }, { status: 502 });
  }

  const perplexityMs = Date.now() - t0;

  // Claude extraction
  const t1 = Date.now();
  const msg = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_DIAGNOSTIC,
    messages: [{
      role: "user",
      content: `Empresa: "${name}"\n\nInvestigación:\n${research.content.slice(0, 5000)}`
    }]
  }).catch(() => null);

  if (msg) {
    void logAiUsage({ functionName: "company_research_diagnostic", model: CLAUDE_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  }

  const claudeMs = Date.now() - t1;

  const rawText = msg?.content?.find((b: { type: string }) => b.type === "text")
    ? (msg!.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string }).text
    : "{}";

  let extracted: Record<string, unknown> = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)?.[0];
    if (jsonMatch) extracted = JSON.parse(jsonMatch);
  } catch { /* defaults */ }

  // Calcular calidad de evidencia
  const citations = research.citations.map(c => ({
    title: c.title,
    url: c.url,
    names_company: citationNamesCompany(c, name)
  }));
  const eqLevel = evidenceQuality(name, research.citations);
  const namedCount = citations.filter(c => c.names_company).length;

  // Keywords a analizar
  const baseKeywords: string[] = [];
  const allKeywords = [
    ...baseKeywords,
    ...extraKeywords
  ].filter((k, i, arr) => k && arr.indexOf(k) === i);

  const keywordMatches = allKeywords.map(kw => ({
    keyword: kw,
    ...countKeywordHits(research.content, kw)
  }));

  return NextResponse.json({
    evidence_type:    eqLevel,
    named_citations:  namedCount,
    total_citations:  citations.length,
    keyword_matches:  keywordMatches,
    extracted: {
      fit_signals:      (extracted.fit_signals      as string | null) ?? null,
      research_summary: (extracted.research_summary as string | null) ?? null,
    },
    citations,
    perplexity: {
      content:     research.content,
      duration_ms: perplexityMs
    },
    claude: {
      raw_response: rawText,
      model_used:   CLAUDE_MODEL,
      duration_ms:  claudeMs
    }
  });
}
