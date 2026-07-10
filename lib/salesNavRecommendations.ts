import { anthropic, CLAUDE_MODEL } from "./claude";
import { extractField, chipsFrom } from "./icp-form";
import { logAiUsage } from "./aiUsageLogger";

export type SalesNavRecommendations = {
  job_title_chips: string[];
  headcount_bands: string[];
  industries: string[];
  locations: string[];
  keywords: string[];
};

const SALES_NAV_HEADCOUNT_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

function splitList(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

// Mapea nuestras bandas de tamaño (del formulario ICP) a las bandas estándar
// de "Company headcount" de Sales Navigator, que agrupan distinto.
function mapHeadcountBands(ourBands: string[]): string[] {
  const map: Record<string, string[]> = {
    "1–10": ["1-10"],
    "11–50": ["11-50"],
    "51–100": ["51-200"],
    "101–200": ["51-200"],
    "201–500": ["201-500"],
    "501–1.000": ["501-1000"],
    "1.000+": ["1001-5000", "5001-10000", "10001+"],
  };
  const out = new Set<string>();
  for (const b of ourBands) (map[b] ?? []).forEach((v) => out.add(v));
  return SALES_NAV_HEADCOUNT_BANDS.filter((b) => out.has(b));
}

function fallback(sections: { target_company: string; fit_signals: string; buyer_persona: string }): SalesNavRecommendations {
  const decisionMakers = splitList(extractField(sections.buyer_persona, "Cargos decisores (quien aprueba)"));
  const influencers = splitList(extractField(sections.buyer_persona, "Cargos influenciadores (quien recomienda)"));
  return {
    job_title_chips: Array.from(new Set([...decisionMakers, ...influencers])).slice(0, 24),
    headcount_bands: mapHeadcountBands(chipsFrom(sections.target_company, "Tamaño (empleados / revenue)")),
    industries: splitList(extractField(sections.target_company, "Industrias objetivo")),
    locations: splitList(extractField(sections.target_company, "Geografías prioritarias")),
    keywords: [
      ...splitList(extractField(sections.fit_signals, "Señales positivas de fit")),
      ...splitList(extractField(sections.fit_signals, "Tecnologías / Stack que usa")),
    ].slice(0, 10),
  };
}

const SYSTEM = `Eres un experto en LinkedIn Sales Navigator. A partir del ICP de un cliente B2B, generá recomendaciones de filtros de búsqueda concretos y listos para pegar.

Reglas:
- job_title_chips: convierte los cargos decisores/influenciadores (a veces descriptivos, ej. "Director or VP of Operations") en cargos CONCRETOS Y CORTOS aptos para el filtro "Current Job Title" de Sales Nav (ej. "Director of Operations", "VP of Operations"). Separa combinaciones con "or"/"y"/"/" en chips individuales, propagando el sufijo común. Máximo 24 chips, sin duplicados.
- headcount_bands: elegí de esta lista exacta las bandas de "Company headcount" que cubran el tamaño objetivo: ["1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10001+"].
- industries: nombres de industria aptos para el filtro "Industry" de Sales Nav (taxonomía tipo LinkedIn, ej. "Hospitals and Health Care").
- locations: ubicaciones para "Headquarters location", por prioridad.
- keywords: 3-8 palabras clave cortas para el buscador de empresas (tech stack, nicho, señales).

Devuelve SOLO JSON válido:
{
  "job_title_chips": string[],
  "headcount_bands": string[],
  "industries": string[],
  "locations": string[],
  "keywords": string[]
}`;

export async function deriveSalesNavRecommendations(sections: {
  target_company: string;
  fit_signals: string;
  buyer_persona: string;
}): Promise<SalesNavRecommendations> {
  const fb = fallback(sections);

  const context = [
    sections.target_company && `PERFIL DE EMPRESA OBJETIVO:\n${sections.target_company}`,
    sections.fit_signals && `SEÑALES DE FIT:\n${sections.fit_signals}`,
    sections.buyer_persona && `BUYER PERSONA:\n${sections.buyer_persona}`,
  ].filter(Boolean).join("\n\n");

  if (!context.trim()) return fb;

  try {
    const msg = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: context.slice(0, 4000) }],
    });
    void logAiUsage({ functionName: "sales_nav_recommendations", model: CLAUDE_MODEL, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
    const text = msg.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string } | undefined;
    const jsonMatch = text?.text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) return fb;
    const parsed = JSON.parse(jsonMatch) as Partial<SalesNavRecommendations>;
    return {
      job_title_chips: parsed.job_title_chips?.length ? parsed.job_title_chips.slice(0, 24) : fb.job_title_chips,
      headcount_bands: parsed.headcount_bands?.length ? parsed.headcount_bands.filter((b) => SALES_NAV_HEADCOUNT_BANDS.includes(b)) : fb.headcount_bands,
      industries: parsed.industries?.length ? parsed.industries : fb.industries,
      locations: parsed.locations?.length ? parsed.locations : fb.locations,
      keywords: parsed.keywords?.length ? parsed.keywords.slice(0, 10) : fb.keywords,
    };
  } catch {
    return fb;
  }
}
