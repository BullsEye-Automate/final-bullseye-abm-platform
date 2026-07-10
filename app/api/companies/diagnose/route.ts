import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { perplexitySearch } from "@/lib/perplexity";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { logAiUsage } from "@/lib/aiUsageLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `Eres analista de prospección B2B. Evalúa si una empresa es un prospecto ideal (ICP fit) para un cliente específico basándote en el ICP provisto.

IMPORTANTE: No inventes datos. Usa ÚNICAMENTE la evidencia provista sobre la empresa.

Devuelve SOLO JSON válido (sin markdown, sin texto extra):
{
  "fit_verdict": "yes" | "no" | "maybe",
  "fit_score": número entre 1 y 10,
  "fit_reason": "2-4 frases explicando el veredicto en español. Sé específico y menciona evidencia concreta.",
  "fit_signals": "señal1 · señal2 · señal3" o null si no hay señales positivas,
  "company_name": "nombre limpio de la empresa",
  "research_summary": "2-3 frases describiendo qué hace la empresa, su sector y tamaño",
  "company_type": "tipo de empresa (startup SaaS, consultora, manufacturera, etc.)" o null,
  "company_size": número de empleados estimado o null,
  "company_country": "país" o null,
  "company_city": "ciudad principal" o null
}

Criterios de veredicto:
- "yes": cumple claramente con el ICP del cliente
- "no": claramente fuera del ICP
- "maybe": algunos indicadores positivos pero información insuficiente o criterios parcialmente cumplidos`;

type Body = {
  name: string;
  linkedin_url?: string;
  website?: string;
  city?: string;
  country?: string;
  client_id: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.name?.trim()) return NextResponse.json({ error: "name es requerido" }, { status: 400 });
  if (!body.client_id) return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });

  const db = supabaseAdmin();

  const [{ data: icpCtx }, trainingResult] = await Promise.all([
    db.from("client_ai_context")
      .select("content")
      .eq("client_id", body.client_id)
      .eq("file_type", "icp")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    Promise.resolve(
      db.from("model_training_config")
        .select("business_description, target_buyer_persona")
        .eq("client_id", body.client_id)
        .maybeSingle()
    ).catch(() => ({ data: null })),
  ]);

  const tc = (trainingResult as any)?.data ?? {};
  const icpContext = [
    icpCtx?.content,
    tc.business_description && `Negocio del cliente: ${tc.business_description}`,
    tc.target_buyer_persona && `Buyer persona objetivo: ${tc.target_buyer_persona}`,
  ].filter(Boolean).join("\n\n") || null;

  // Perplexity research
  const hintParts: string[] = [];
  if (body.city)         hintParts.push(`ciudad: ${body.city}`);
  if (body.country)      hintParts.push(`país: ${body.country}`);
  if (body.linkedin_url) hintParts.push(`LinkedIn: ${body.linkedin_url}`);
  if (body.website)      hintParts.push(`web: ${body.website}`);
  const hintLine = hintParts.length ? ` (${hintParts.join(", ")})` : "";

  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B. Busca información pública y verificable sobre la empresa indicada.",
    user: `Investiga detalladamente la empresa "${body.name.trim()}"${hintLine}. Encuentra: descripción del negocio, sector, productos/servicios, tamaño en empleados, ubicación, señales de crecimiento, tecnologías que usan, clientes o socios conocidos, modelo de negocio B2B o B2C.`,
  }).catch(() => null);

  if (!research?.content) {
    return NextResponse.json({ error: "No se pudo investigar la empresa (Perplexity no disponible)" }, { status: 502 });
  }

  // Claude fit analysis
  const userMsg = [
    icpContext
      ? `ICP DEL CLIENTE:\n${icpContext}`
      : "ICP: (no configurado — evalúa en base a señales generales de empresa B2B de calidad)",
    `\nEMPRESA A EVALUAR: "${body.name.trim()}"`,
    body.linkedin_url ? `LinkedIn: ${body.linkedin_url}` : null,
    body.website      ? `Web: ${body.website}` : null,
    `\nINVESTIGACIÓN WEB:\n${research.content.slice(0, 6000)}`,
  ].filter(Boolean).join("\n");

  const msg = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  }).catch(() => null);

  if (msg) {
    void logAiUsage({ clientId: body.client_id, functionName: "company_diagnose", model: CLAUDE_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  }

  const rawText = (msg?.content?.find((b: any) => b.type === "text") as any)?.text ?? "{}";
  let extracted: Record<string, any> = {};
  try {
    const m = rawText.match(/\{[\s\S]*\}/)?.[0];
    if (m) extracted = JSON.parse(m);
  } catch { /* defaults */ }

  return NextResponse.json({
    fit_verdict:      extracted.fit_verdict      ?? "maybe",
    fit_score:        extracted.fit_score        ?? null,
    fit_reason:       extracted.fit_reason       ?? null,
    fit_signals:      extracted.fit_signals      ?? null,
    company_name:     extracted.company_name     ?? body.name.trim(),
    research_summary: extracted.research_summary ?? null,
    company_type:     extracted.company_type     ?? null,
    company_size:     extracted.company_size     ?? null,
    company_country:  extracted.company_country  ?? null,
    company_city:     extracted.company_city     ?? null,
    _raw: {
      linkedin_url:       body.linkedin_url ?? null,
      website:            body.website      ?? null,
      perplexity_content: research.content,
    },
  });
}
