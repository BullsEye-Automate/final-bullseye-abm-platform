import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { perplexitySearch, PerplexityCitation } from "@/lib/perplexity";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";
import { logAiUsage } from "@/lib/aiUsageLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_ONE = `Eres analista de prospección B2B. A partir de la investigación web de UNA empresa específica, extrae sus datos en JSON.

Reglas:
- Usa ÚNICAMENTE la evidencia provista. No inventes datos.
- company_linkedin_url: solo si aparece literal en la evidencia (formato https://www.linkedin.com/company/<slug>). Si dudas, null.
- company_website: solo si aparece literal. Si dudas, null.
- fit_signals: señales de fit separadas por " · ". Si no hay evidencia, string vacío.
- fit_score: "high" si hay señales claras, "medium" si hay algunas, "low" si no hay evidencia de fit.

Devuelve SOLO JSON válido:
{
  "company_name": string,
  "company_website": string | null,
  "company_linkedin_url": string | null,
  "company_city": string | null,
  "company_country": string | null,
  "company_size": number | null,
  "company_type": "other",
  "fit_signals": string,
  "fit_score": "high" | "medium" | "low",
  "competitor_match": string | null,
  "research_summary": string
}`;

type Body = {
  name: string;
  linkedin_url?: string;
  website?: string;
  city?: string;
  country?: string;
  client_id?: string | null;
  require_linkedin?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "El campo 'name' es requerido" }, { status: 400 });
  }
  if (body.require_linkedin && !body.linkedin_url?.trim()) {
    return NextResponse.json({ error: "El LinkedIn de la empresa es obligatorio" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const name = body.name.trim();

  // Verificar si ya existe
  const { data: existing } = await db
    .from("companies")
    .select("id, company_name, status")
    .ilike("company_name", name)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ already_exists: true, company: existing });
  }

  // Construir query para Perplexity
  const hints: string[] = [];
  if (body.city)         hints.push(`ciudad: ${body.city}`);
  if (body.country)      hints.push(`país: ${body.country}`);
  if (body.linkedin_url) hints.push(`LinkedIn: ${body.linkedin_url}`);
  if (body.website)      hints.push(`web: ${body.website}`);

  const hintLine = hints.length > 0 ? ` (${hints.join(", ")})` : "";

  const t0 = Date.now();
  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B. Busca información verificable sobre la empresa indicada. Incluye URL de LinkedIn corporativo si la encuentras.",
    user: `Investiga la empresa "${name}"${hintLine}. Encuentra: sitio web oficial, URL de LinkedIn corporativo, ciudad, país, tamaño aproximado en empleados, sector/industria, tecnologías que usan, señales de crecimiento o fit B2B.`
  }).catch(() => null);

  if (!research?.content) {
    return NextResponse.json({ error: "No se pudo investigar la empresa. Intentá de nuevo." }, { status: 502 });
  }

  // Claude extrae estructura
  const t1 = Date.now();
  const msg = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_ONE,
    messages: [{
      role: "user",
      content: `Empresa a analizar: "${name}"\n\nInvestigación web:\n${research.content.slice(0, 5000)}`
    }]
  }).catch(() => null);

  if (msg) {
    void logAiUsage({ clientId: body.client_id, functionName: "company_research_one", model: CLAUDE_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  }

  const rawText = msg?.content?.find((b: { type: string }) => b.type === "text")
    ? (msg!.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string }).text
    : null;

  let extracted: Record<string, unknown> = { company_name: name, fit_signals: "", fit_score: "low", research_summary: "" };
  try {
    const jsonMatch = rawText?.match(/\{[\s\S]*\}/)?.[0];
    if (jsonMatch) extracted = JSON.parse(jsonMatch);
  } catch { /* usa defaults */ }

  // Normalizar LinkedIn
  if (extracted.company_linkedin_url) {
    extracted.company_linkedin_url = normalizeLinkedInUrl(extracted.company_linkedin_url as string);
  }

  // Si el usuario proveyó el LinkedIn de la empresa a mano, es la fuente de verdad:
  // no dejamos que la extracción de Claude lo pise ni lo vacíe (regla "solo si aparece
  // literal en la evidencia" puede descartarlo aunque el usuario ya lo confirmó).
  // Sin esto, Clay recibe linkedin_url vacío y la columna "Find People" queda bloqueada
  // con "Company Identifier is blank".
  const userLinkedin = body.linkedin_url?.trim() ? normalizeLinkedInUrl(body.linkedin_url) : null;

  const row = {
    company_name:         (extracted.company_name as string) || name,
    company_website:      (extracted.company_website as string | null) ?? null,
    company_linkedin_url: userLinkedin ?? (extracted.company_linkedin_url as string | null) ?? null,
    company_city:         (extracted.company_city as string | null) ?? null,
    company_country:      (extracted.company_country as string | null) ?? null,
    company_size:         (extracted.company_size as number | null) ?? null,
    company_type:         (extracted.company_type as string) || "other",
    fit_signals:          (extracted.fit_signals as string) || "",
    fit_score:            (extracted.fit_score as string) || "low",
    competitor_match:     (extracted.competitor_match as string | null) ?? null,
    research_summary:     (extracted.research_summary as string) || "",
    research_sources:     research.citations as unknown as PerplexityCitation[],
    status:               "pending" as const,
    client_id:            body.client_id ?? null,
    icp_version:          null,
  };

  const { data: inserted, error: insertErr } = await db
    .from("companies")
    .insert(row)
    .select("*")
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ company: inserted, research_ms: Date.now() - t0, claude_ms: Date.now() - t1 });
}
