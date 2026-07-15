import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, CLAUDE_MODEL } from "./claude";
import { perplexitySearch } from "./perplexity";
import { logAiUsage } from "./aiUsageLogger";

export type DeepResearchResult = {
  trigger: string;
  angulo: string;
  senales: string[];
  decisores: string[];
  resumen_ejecutivo: string;
  fuentes: { title: string; url: string }[];
};

const SYSTEM_DEEP_RESEARCH = `Eres especialista en personalización de outreach B2B para BullsEye, agencia de prospección ABM.

Tu trabajo: dado un research web sobre una empresa específica y el ICP del cliente, extraer el ángulo de personalización más poderoso para el primer mensaje de outreach.

Reglas ESTRICTAS e INNEGOCIABLES:
1. USA SOLO información que esté EXPLÍCITAMENTE en la evidencia provista. NUNCA inventes, supongas ni extrapoles datos.
2. Cada señal en "senales" DEBE incluir la fecha o período (ej: "enero 2026", "Q1 2026", "marzo 2026"). Si no hay fecha en la fuente, no incluyas esa señal.
3. SOLO incluye señales de los últimos 6 meses. Si la evidencia solo tiene información más antigua, indícalo claramente en el trigger en lugar de usarla como si fuera reciente.
4. Si la evidencia NO contiene señales recientes verificables, el trigger debe decir explícitamente "Sin señales recientes verificadas en la evidencia disponible" — NO inventes un trigger plausible.
5. Los decisores SOLO si están mencionados con nombre completo y cargo exacto en la evidencia. Sin suposiciones de cargo por título de LinkedIn.
6. El año actual es 2026. Los últimos 6 meses son desde enero 2026. Cualquier evento anterior a enero 2026 NO es reciente.

Devuelve SIEMPRE JSON válido con esta forma exacta:
{
  "trigger": "1-2 frases sobre qué está pasando en la empresa HOY (con fecha). Si no hay evidencia reciente, escribir: 'Sin señales recientes verificadas en la evidencia disponible'",
  "angulo": "1-2 frases sobre cómo enfocar el primer mensaje para que resuene. Solo si hay trigger real; si no, escribir: 'Usar ángulo genérico de ICP'",
  "senales": ["señal concreta con dato verificable Y FECHA 1", "señal 2 con fecha", "señal 3 con fecha"],
  "decisores": ["Nombre Apellido - Cargo exacto (solo si está en la evidencia)"],
  "resumen_ejecutivo": "párrafo de 3-4 frases combinando todo el contexto. Si no hay señales recientes, indicarlo explícitamente en lugar de inventar contexto."
}`;

export async function runDeepResearch(opts: {
  companyName: string;
  companyWebsite: string | null;
  companyLinkedin: string | null;
  companyCountry: string | null;
  icpContent: string;
}): Promise<DeepResearchResult> {
  const { companyName, companyWebsite, companyCountry, icpContent } = opts;

  const websiteRef  = companyWebsite  ? ` (${companyWebsite})`  : "";
  const countryRef  = companyCountry  ? ` en ${companyCountry}` : "";

  // Extraer resumen del ICP para orientar la búsqueda (primeros 1200 chars son suficientes)
  const icpSummary = icpContent?.trim()
    ? `\nContexto del cliente que hace el outreach (úsalo para entender qué tipo de señales son relevantes):\n${icpContent.slice(0, 1200)}\n`
    : "";

  const perplexityUser = `Investiga en detalle la empresa "${companyName}"${websiteRef}${countryRef}. El año actual es 2026. Necesito ÚNICAMENTE información de los últimos 6 meses (desde enero 2026 en adelante), con fechas exactas para cada dato.
${icpSummary}
1. **Noticias y eventos recientes (últimos 6 meses, con fecha)**: resultados financieros, adquisiciones, fusiones, expansiones geográficas, nuevos mercados, lanzamientos de producto o formato, inversiones, hitos de crecimiento, cambios organizacionales relevantes, premios o reconocimientos. INCLUIR la fecha de cada evento.
2. **Cambios en el equipo directivo**: nuevos C-levels, VPs o directores nombrados desde enero 2026 — nombres completos y cargos.
3. **Señales de transformación o presión del negocio (con fecha)**: ¿han anunciado reestructuraciones, nuevas iniciativas estratégicas, cambios de modelo de negocio, problemas operacionales o de rentabilidad? ¿Mencionan prioridades para 2026 en entrevistas, reportes o notas de prensa?
4. **Señales relevantes para el contexto del cliente**: dado el contexto del cliente descrito arriba, ¿qué está haciendo esta empresa que conecte con esa propuesta de valor? Busca eventos, declaraciones o cambios que sean señales de compra o dolor.
5. **Equipo comercial y stack tecnológico**: CRM que usan, herramientas de marketing/ventas, tamaño del equipo comercial si se menciona.

IMPORTANTE: Para cada dato, indica la fecha o fuente con fecha. Si no encuentras información reciente (desde enero 2026), indícalo explícitamente en lugar de usar información más antigua.
Prioriza fuentes verificables: LinkedIn, notas de prensa, reportes financieros, entrevistas, podcasts, blogs oficiales, Crunchbase.`;

  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B especializado en investigar empresas específicas. Busca información pública verificable y reciente. Cita todas las fuentes con URL.",
    user:   perplexityUser,
    searchRecencyFilter: "year"
  });

  // Claude extrae el ángulo de personalización con el ICP como contexto cacheado
  const message = await anthropic().messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_DEEP_RESEARCH },
      {
        type:          "text",
        text:          `# ICP del cliente\n\n${icpContent}`,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role:    "user",
        content: `Empresa investigada: **${companyName}**

Investigación de Perplexity:
${research.content}

---
Extrae el ángulo de personalización para el outreach de BullsEye hacia esta empresa. Devuelve JSON estricto.`
      }
    ]
  });

  void logAiUsage({ functionName: "deep_research", model: "claude-haiku-4-5-20251001", inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, metadata: { companyName } });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text);

  return {
    trigger:            parsed?.trigger            ?? "Sin trigger detectado",
    angulo:             parsed?.angulo             ?? "Sin ángulo detectado",
    senales:            Array.isArray(parsed?.senales)    ? parsed.senales    : [],
    decisores:          Array.isArray(parsed?.decisores)  ? parsed.decisores  : [],
    resumen_ejecutivo:  parsed?.resumen_ejecutivo  ?? "",
    fuentes:            research.citations.slice(0, 6)
  };
}

// Helper reutilizable: lanza deep research para una empresa y guarda el resultado en Supabase.
// Pensado para fire-and-forget: llama sin await y encadena .catch(() => {}).
export async function triggerDeepResearchForCompany(
  db: SupabaseClient,
  companyId: string
): Promise<void> {
  const { data: company } = await db
    .from("companies")
    .select("id, company_name, company_website, company_linkedin_url, company_country, client_id, deep_research")
    .eq("id", companyId)
    .maybeSingle();

  if (!company) return;
  // No re-investigar si ya tiene deep_research guardado
  if (company.deep_research) return;

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", company.client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!icpCtx?.content?.trim()) return;

  const result = await runDeepResearch({
    companyName:     company.company_name,
    companyWebsite:  company.company_website,
    companyLinkedin: company.company_linkedin_url,
    companyCountry:  company.company_country,
    icpContent:      icpCtx.content,
  });

  await db
    .from("companies")
    .update({ deep_research: JSON.stringify(result) })
    .eq("id", companyId);
}

function extractJson(text: string): any {
  const fence     = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}
