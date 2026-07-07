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

Reglas estrictas:
- Solo usa información que esté en la evidencia provista. No inventes datos.
- Prioriza eventos recientes (últimos 6 meses).
- El trigger debe ser algo concreto y verificable: expansión, contratación, noticia, funding, nuevo mercado.
- El ángulo conecta el trigger con el servicio del cliente (prospección ABM B2B personalizada).
- Los decisores solo si están EXPLÍCITAMENTE mencionados en la evidencia con nombre y cargo.
- El resumen_ejecutivo es un párrafo directo listo para usar como briefing al escribir el mensaje.

Devuelve SIEMPRE JSON válido con esta forma exacta:
{
  "trigger": "1-2 frases sobre qué está pasando en la empresa hoy que la hace receptiva",
  "angulo": "1-2 frases sobre cómo enfocar el primer mensaje para que resuene",
  "senales": ["señal concreta con dato verificable 1", "señal concreta 2", "señal concreta 3"],
  "decisores": ["Nombre Apellido - Cargo", "..."],
  "resumen_ejecutivo": "párrafo de 3-4 frases combinando todo el contexto, listo para usar como briefing al redactar el mensaje de outreach"
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

  const perplexityUser = `Investiga en detalle la empresa "${companyName}"${websiteRef}${countryRef}. Necesito información específica y reciente sobre:

1. **Noticias y eventos recientes (últimos 6–12 meses)**: expansiones geográficas, nuevos mercados, lanzamientos de producto, inversiones, rondas de funding, hitos de crecimiento, premios o reconocimientos.
2. **Equipo directivo actual**: CEO, Founder, VP de Ventas, VP de Marketing, Director Comercial, Head of Growth — nombres completos y cargos actuales.
3. **Señales comerciales y de crecimiento**: ¿están contratando SDRs, BDRs, Account Executives o roles de growth? ¿participan en eventos B2B? ¿mencionan expansión en entrevistas o podcasts?
4. **Stack tecnológico**: CRM que usan (HubSpot, Salesforce, Pipedrive, Zoho...), herramientas de sales engagement, marketing automation.
5. **Modelo comercial actual**: a quién venden, en qué mercados están activos, tamaño del equipo de ventas si se menciona.
6. **Indicios de necesidad de ABM/prospección**: ¿dependen de inbound o referidos? ¿mencionan necesidad de pipeline más predecible? ¿buscan abrir cuentas estratégicas?

Prioriza fuentes verificables: LinkedIn, notas de prensa, entrevistas, podcasts, blogs de la empresa, AngelList, Crunchbase.`;

  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B especializado en investigar empresas específicas. Busca información pública verificable y reciente. Cita todas las fuentes con URL.",
    user:   perplexityUser,
    searchRecencyFilter: "year"
  });

  // Claude extrae el ángulo de personalización con el ICP como contexto cacheado
  const message = await anthropic().messages.create({
    model:      CLAUDE_MODEL,
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

  void logAiUsage({ functionName: "deep_research", model: CLAUDE_MODEL, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, metadata: { companyName } });

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
