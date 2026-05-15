// Research de UNA empresa puntual (por nombre + hints opcionales).
// Sprint 5 fase 6 — alimenta dos features de /empresas:
//   1. "Buscar por nombre": el usuario tipea un nombre, la IA lo investiga.
//   2. "Importar objetivo": CSV con empresas target, cada fila pasa por acá.
//
// Diferencia clave con discoverCompanies (lib/discovery.ts): acá el usuario
// ELIGIÓ la empresa, así que SIEMPRE devolvemos una tarjeta — incluso si el
// fit es bajo o si no es del rubro. El research_summary es honesto: si no es
// un laboratorio dental, lo dice. El usuario decide si la aprueba o rechaza.

import type Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback } from "./claude";
import { perplexitySearch, PerplexityCitation } from "./perplexity";
import type { IcpConfig } from "./supabase";
import type { DiscoveredCompany } from "./discovery";
import { isValidLinkedinCompanyUrl } from "./discovery";

export type CompanyHints = {
  name: string;
  linkedin_url?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
};

export type ResearchOneResult = {
  company: DiscoveredCompany | null;
  // true si Perplexity/Claude no encontraron NADA reconocible de esta empresa.
  not_found: boolean;
  // true si la empresa existe pero claramente no es del rubro target
  // (no es lab/multi_clinic/dso). La tarjeta igual se devuelve.
  off_target: boolean;
  diagnostics: {
    perplexity_content_chars: number;
    claude_model_used: string;
    claude_response_preview: string;
  };
};

export const SYSTEM_RESEARCH_ONE = `Eres analista de prospección B2B para weCAD4you, un servicio de outsourcing de diseño CAD/CAM dental (exocad / inLab).

Tu tarea: investigar UNA empresa puntual que el usuario eligió, y devolver una ficha estructurada honesta.

Reglas:
- Trabajas SOLO con la evidencia provista por la búsqueda web. No inventes datos. Lo que no esté en la evidencia va en null.
- El usuario eligió esta empresa, así que SIEMPRE devuelves una ficha — incluso si el fit es bajo o si la empresa NO es del rubro dental. NO la descartes; describí honestamente lo que es.
- company_type: clasifícala con honestidad.
  - "lab" = laboratorio dental
  - "multi_clinic" = grupo de clínicas dentales multi-centro
  - "dso" = Dental Service Organization
  - "other" = CUALQUIER otra cosa (distribuidor, fabricante de equipos, proveedor de insumos, centro de fresado que solo vende equipos, consultora, o una empresa de otra industria que no tiene nada que ver con odontología).
- Si la empresa NO es un laboratorio dental / clínica multi-centro / DSO, poné company_type="other", fit_score="low", y en research_summary explicá CLARAMENTE qué es realmente y por qué no es fit (ej: "No es un laboratorio dental. Es un distribuidor de insumos dentales / es una empresa de biotecnología vegetal / etc.").
- company_linkedin_url: si la evidencia trae la URL corporativa de LinkedIn en formato https://www.linkedin.com/company/<slug>, inclúyela LITERAL. Si el usuario ya te dio una URL en los hints y es válida, usá esa. Si no hay ninguna, null — no la inventes.
- company_country: código ISO de 2 letras (US, CA, MX, GB, ES, etc.) cuando puedas inferirlo. Si no, null.
- company_size: estima empleados. Si la evidencia da un rango, usa el punto medio. Si no hay dato, null.
- company_website: literal de la evidencia, o el que vino en hints. Si dudás, null.

Scoring (fit_score):
- "high": lab con exocad o inLab confirmado, O empresa que ya externaliza diseño con un competidor (Evident, Full Contour, Aidite, Automate by 3Shape).
- "medium": lab con 3Shape o Dental Wings, O lab con señales digitales fuertes sin software CAD confirmado, O lab exocad/inLab sin evidencia adicional.
- "low": evidencia digital débil, flujo posiblemente analógico, tamaño fuera de banda, O empresa que no es del rubro dental.

Devuelve SIEMPRE JSON válido con esta forma exacta:
{
  "found": boolean,
  "company": {
    "company_name": string,
    "company_website": string | null,
    "company_linkedin_url": string | null,
    "company_city": string | null,
    "company_country": string | null,
    "company_size": number | null,
    "company_type": "lab" | "multi_clinic" | "dso" | "other",
    "cad_software": string | null,
    "scanner_technology": string | null,
    "fit_signals": string,
    "fit_score": "high" | "medium" | "low",
    "competitor_match": string | null,
    "research_summary": string
  }
}
"found": false SOLO si la búsqueda web no devolvió nada reconocible de esta empresa (nombre demasiado genérico, sin presencia web). En ese caso "company" puede ser null.
fit_signals: lista corta separada por " · " de las señales detectadas. Si no es del rubro, poné algo como "Fuera de rubro · <qué es>".
research_summary: 2-4 frases. Honesto. Si es fit, por qué. Si no, qué es realmente y por qué no.`;

export function buildResearchPrompt(hints: CompanyHints): string {
  const lines: string[] = [];
  lines.push(`Investigá esta empresa puntual y decime si es un laboratorio dental, clínica multi-centro o DSO con flujo digital CAD/CAM, o qué es realmente.`);
  lines.push(``);
  lines.push(`EMPRESA: ${hints.name}`);
  if (hints.linkedin_url) lines.push(`LinkedIn (dato del usuario): ${hints.linkedin_url}`);
  if (hints.website) lines.push(`Sitio web (dato del usuario): ${hints.website}`);
  if (hints.city) lines.push(`Ciudad (dato del usuario): ${hints.city}`);
  if (hints.country) lines.push(`País (dato del usuario): ${hints.country}`);
  lines.push(``);
  lines.push(`Buscá en fuentes públicas:`);
  lines.push(`- Qué tipo de empresa es exactamente (laboratorio dental / clínica / DSO / distribuidor / fabricante / otra industria).`);
  lines.push(`- Software CAD que usan (exocad, inLab, 3Shape, Dental Wings).`);
  lines.push(`- Escáneres intraorales (iTero, Medit, Carestream, Cerec).`);
  lines.push(`- Tamaño aproximado en empleados.`);
  lines.push(`- Ubicación (ciudad, país).`);
  lines.push(`- URL de LinkedIn corporativo en formato https://www.linkedin.com/company/<slug>.`);
  lines.push(`- Sitio web oficial.`);
  lines.push(`- Si externalizan diseño CAD con algún competidor (Evident, Full Contour, Aidite, Automate by 3Shape).`);
  lines.push(`- Señales activas: contratando técnico CAD, casos digitales publicados, expansión.`);
  lines.push(``);
  lines.push(`Citá la fuente de cada dato con [N].`);
  return lines.join("\n");
}

function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function renderIcpBrief(icp: IcpConfig): string {
  return [
    `ICP weCAD4you v${icp.version} (resumen):`,
    `Tipos aceptados: ${icp.org_types.filter((o) => o.accept).map((o) => o.label).join(", ")}`,
    `Señales fuertes: ${icp.signals_strong.join(", ")}`,
    `Competidores (externalización = fit inmediato): ${icp.competitors.map((c) => c.name).join(", ")}`
  ].join("\n");
}

export async function researchOneCompany(
  hints: CompanyHints,
  icp: IcpConfig
): Promise<ResearchOneResult> {
  // 1) Perplexity research apuntado a esta empresa
  const research = await perplexitySearch({
    system:
      "Eres un asistente de research B2B. Investigá la empresa puntual que te piden con evidencia pública verificable. Citá fuentes. Sé preciso sobre qué tipo de empresa es realmente.",
    user: buildResearchPrompt(hints)
  });

  // 2) Claude extraction → una sola empresa
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_RESEARCH_ONE },
      { type: "text", text: renderIcpBrief(icp), cache_control: { type: "ephemeral" } }
    ],
    messages: [
      {
        role: "user",
        content: `Empresa pedida por el usuario: "${hints.name}"
${hints.linkedin_url ? `LinkedIn dado: ${hints.linkedin_url}\n` : ""}${hints.website ? `Sitio dado: ${hints.website}\n` : ""}
Investigación de Perplexity (con citas [1], [2], ...):

${research.content}

---

Devolvé el JSON estricto definido en el sistema para ESTA empresa.`
      }
    ]
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text);
  const diagnostics = {
    perplexity_content_chars: research.content.length,
    claude_model_used: model_used,
    claude_response_preview: text.slice(0, 600)
  };

  if (!parsed || parsed.found === false || !parsed.company) {
    return { company: null, not_found: true, off_target: false, diagnostics };
  }

  const c = parsed.company;
  // Si el usuario pasó un LinkedIn válido y Claude no devolvió uno, usamos el del usuario.
  let linkedinUrl: string | null = c.company_linkedin_url ?? null;
  if (!isValidLinkedinCompanyUrl(linkedinUrl) && isValidLinkedinCompanyUrl(hints.linkedin_url)) {
    linkedinUrl = hints.linkedin_url!.trim();
  }

  const company: DiscoveredCompany = {
    company_name: String(c.company_name ?? hints.name).trim() || hints.name,
    company_website: c.company_website ?? hints.website ?? null,
    company_linkedin_url: linkedinUrl,
    company_city: c.company_city ?? hints.city ?? null,
    company_country: c.company_country ?? hints.country ?? null,
    company_size: typeof c.company_size === "number" ? c.company_size : null,
    company_type: ["lab", "multi_clinic", "dso", "other"].includes(c.company_type)
      ? c.company_type
      : "other",
    cad_software: c.cad_software ?? null,
    scanner_technology: c.scanner_technology ?? null,
    fit_signals: String(c.fit_signals ?? ""),
    fit_score: ["high", "medium", "low"].includes(c.fit_score) ? c.fit_score : "low",
    competitor_match: c.competitor_match ?? null,
    research_summary: String(c.research_summary ?? ""),
    research_sources: research.citations
  };

  const offTarget = company.company_type === "other";
  return { company, not_found: false, off_target: offTarget, diagnostics };
}
