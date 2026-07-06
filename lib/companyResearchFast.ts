import { anthropic, CLAUDE_MODEL } from "./claude";

// Research rápido de una empresa usando SOLO Claude (sin Perplexity ni el
// salvataje de LinkedIn corporativo). Pensado para "búsqueda manual": el SDR
// ya encontró contactos reales a mano en Sales Navigator, así que la empresa
// va directo a Lemlist/CRM sin research profundo — solo necesita quedar
// clasificada para reportería y para dar contexto de fit en los mensajes.
export type FastResearchHints = {
  name: string;
  sampleJobTitles?: string[];
  city?: string | null;
  country?: string | null;
};

export type FastResearchResult = {
  company_type: string;
  fit_signals: string;
  fit_score: "high" | "medium" | "low";
  research_summary: string;
};

const SYSTEM = `Eres analista de prospección B2B. Te dan el nombre de una empresa y, opcionalmente, los cargos de personas que un SDR ya encontró trabajando ahí (evidencia real de que la empresa existe y tiene ese tipo de roles). NO tienes acceso a research web — no inventes datos concretos (sitio web, tamaño exacto, ciudad, tecnologías) que no te den como evidencia.

Con lo que tengas, clasifica la empresa de forma breve y conservadora. Si no hay evidencia suficiente, usa fit_score "medium" (ya sabemos que el SDR la consideró candidata) y sé escueto.

Devuelve SOLO JSON válido:
{
  "company_type": "other",
  "fit_signals": string,
  "fit_score": "high" | "medium" | "low",
  "research_summary": string
}`;

const FALLBACK: FastResearchResult = {
  company_type: "other",
  fit_signals: "",
  fit_score: "medium",
  research_summary: "Empresa cargada desde búsqueda manual (Sales Navigator) — sin research profundo.",
};

export async function researchOneCompanyFast(hints: FastResearchHints, icpContext?: string): Promise<FastResearchResult> {
  const lines: string[] = [`Empresa: "${hints.name}"`];
  if (hints.sampleJobTitles?.length) lines.push(`Cargos encontrados en esta empresa por el SDR: ${hints.sampleJobTitles.join(", ")}`);
  if (hints.city || hints.country) lines.push(`Ubicación aproximada: ${[hints.city, hints.country].filter(Boolean).join(", ")}`);
  if (icpContext) lines.push(`\nContexto del ICP del cliente:\n${icpContext.slice(0, 2000)}`);

  try {
    const msg = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: lines.join("\n") }],
    });

    const text = msg.content.find((b: { type: string }) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const jsonMatch = text?.text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) return FALLBACK;

    const parsed = JSON.parse(jsonMatch) as Partial<FastResearchResult>;
    return {
      company_type: parsed.company_type || "other",
      fit_signals: parsed.fit_signals ?? "",
      fit_score: parsed.fit_score ?? "medium",
      research_summary: parsed.research_summary || FALLBACK.research_summary,
    };
  } catch {
    return FALLBACK;
  }
}
