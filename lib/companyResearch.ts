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
import { isValidLinkedinCompanyUrl, salvageEmployeeCounts } from "./discovery";
import { validateCompanyEvidence, evidenceQuality } from "./companyEvidence";

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

Tu tarea: investigar UNA empresa puntual que el usuario eligió, y devolver una ficha estructurada HONESTA.

PRINCIPIO RECTOR (no negociable):
PREFIERO HONESTIDAD SOBRE COMPLETITUD. Si no hay información pública sobre algún campo (software, escáner, externalización), el valor correcto es null y la mejor descripción es "No hay información pública sobre X". NO inventes. NO inferas del contexto general del rubro. NO extrapoles de "es típico que labs de este tamaño usen Y". Una ficha honesta con la mitad de los campos en null y un research_summary que diga "sin info pública" es 1000 veces mejor que una ficha con datos inventados que después rompe el outreach.

REGLA DE EVIDENCIA POR HECHO:
Cada hecho operativo que reportes (cad_software, scanner_technology, competitor_match, contratación activa, expansión, casos digitales) DEBE estar respaldado por una cita [N] específica del texto de Perplexity que LITERALMENTE nombre a esta empresa Y describa el hecho. Las citas genéricas del rubro (PDFs académicos, guías universitarias, artículos de tendencias) NO sirven como respaldo de hechos operativos — sirven solo para confirmar que el rubro existe.

Si no hay cita específica que nombre a esta empresa Y describa el hecho:
  → cad_software, scanner_technology, competitor_match → null
  → fit_signals → no incluir esa señal operativa
  → fit_score → NUNCA "high"

Reglas:
- Trabajas SOLO con la evidencia provista por la búsqueda web. Lo que no esté en la evidencia con cita específica de esta empresa, va en null.
- El usuario eligió esta empresa, así que SIEMPRE devuelves una ficha — incluso si el fit es bajo o si la empresa NO es del rubro dental. NO la descartes; describí honestamente lo que es y qué información hay (o no hay) sobre ella.
- company_type: clasifícala con honestidad.
  - "lab" = laboratorio dental con producción propia.
  - "multi_clinic" = grupo de **2 o más** clínicas dentales operadas centralizadamente bajo un mismo dueño/management. Una clínica privada de UNA sola sede = NO entra acá (es "other").
  - "dso" = Dental Service Organization (corporativo multi-clínica con management profesional, generalmente backed por PE).
  - "other" = CUALQUIER otra cosa: clínica privada single-practice, distribuidor, fabricante de equipos, proveedor de insumos, centro de fresado que solo vende equipos, consultora, empresa de otra industria.
- Si la empresa NO es un laboratorio dental / clínica multi-centro (2+ sedes) / DSO, poné company_type="other", fit_score="low", y en research_summary explicá CLARAMENTE qué es realmente.
- company_linkedin_url: literal de la evidencia o del hint del usuario. NUNCA inventes ni construyas desde el nombre. Si no, null.
- company_country: código ISO de 2 letras solo si la evidencia lo confirma. Si no, null.
- company_size (número de empleados): SOLO desde el contador "X employees" / "X empleados" de la página corporativa de LinkedIn — es lo único actualizado. Aceptable también una página oficial reciente de la empresa que diga el número literal (About Us, Team, Careers, comunicado de prensa último año). NO ACEPTABLE: Manta, BBB, Yelp, ZoomInfo, Hoovers, Crunchbase rangos viejos, directorios sin fecha — están sistemáticamente desactualizados 5-10 años. Si la única fuente disponible es uno de esos directorios → null. MEJOR NULL QUE UN NÚMERO FALSO (un número malo rompe la personalización del outreach).
- company_website: literal de la evidencia o de hints. Si dudás, null.

Scoring (fit_score) — escala por niveles de evidencia:

- "low" (default para empresas del rubro): es claramente lab/multi_clinic(2+ sedes)/DSO con flujo digital base asumido. NO requiere cita de software/escáner — alcanza con que esté establecida con web propia o LinkedIn corporativo válido.

- "medium" (low + AL MENOS UNA señal operativa adicional, con cita específica que nombre la empresa):
  - Contratando CAD designer / 3D designer / dental technician CAD (job posting).
  - Web menciona aceptar múltiples scanners intraorales (multi-scanner support).
  - Usa exocad confirmado.
  - Usa Dentsply Sirona stack (DS Core, Primescan, CEREC, inLab) confirmado.
  - Otra tecnología CAD/CAM confirmada (3Shape, Dental Wings, Formlabs, NextDent, 3D Systems).
  - Tutoriales o contenido educativo propio sobre workflow digital.

- "high" (medium + externalización CAD confirmada): ya externaliza diseños CAD a freelance, empresa de diseño, o competidor nuestro (Evident, Full Contour, Aidite, Automate by 3Shape, NDX, Drake Labs). Requiere cita específica que nombre la empresa Y mencione la externalización.

Reglas:
- Si NO hay AL MENOS UNA cita específica que nombre la empresa Y describa una señal operativa → fit_score = "low".
- Si la empresa NO es del rubro dental → company_type="other" + fit_score="low".
- NO inventes señales. Sin cita → no upgrade.

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

fit_signals (formato exacto):
- Lista corta separada por " · ". CADA señal operativa (software, escáner, externalización, contratación, expansión, casos) debe terminar con [N] indicando la cita exacta que la respalda. Las descriptivas (tipo, ubicación, tamaño) no requieren [N].
- Si no hay señales operativas con cita específica, fit_signals puede ser corto (solo descriptivo) o decir explícitamente "Sin información pública sobre software CAD, escáner ni operación digital". NO inventes señales para llenar el campo.
- Ejemplos válidos:
  - "Laboratorio dental local · exocad confirmado en página de servicios [2] · contratando CAD designer (job posting) [4]" ← operativas con [N].
  - "Laboratorio dental local · Sin información pública sobre software CAD ni escáner" ← honesto sin inventos.
  - "Distribuidor de insumos dentales · Fuera de rubro" ← descriptivo cuando no es target.

research_summary: 2-4 frases. HONESTO. Si hay evidencia específica, decí qué encontraste y cuál es la fuente. Si NO hay evidencia específica, escribí literalmente algo como: "Listada como [tipo] en [fuente]. No hay información pública sobre software CAD, escáner, externalización ni operaciones digitales. Fit incierto sin verificación directa." NUNCA inventes una narrativa optimista para que la ficha parezca completa.`;

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

  const rawCompany: DiscoveredCompany = {
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
    research_sources: research.citations,
    evidence_quality: evidenceQuality(
      String(c.company_name ?? hints.name).trim() || hints.name,
      research.citations
    )
  };

  // Validación de evidencia (mismo régimen que discovery broad): strippea
  // señales operativas sin cita específica que nombre la empresa, nulea
  // campos operativos cuando la evidencia es genérica, degrada fit_score.
  const { company: validated, outcome } = validateCompanyEvidence(rawCompany);
  let company: DiscoveredCompany = {
    ...validated,
    evidence_quality: outcome.evidence_quality
  };

  // Pase dedicado: confirmar el employee count desde LinkedIn cuando hay
  // URL válida. Sobreescribe si encuentra un número en LinkedIn (que es la
  // fuente más actualizada). Si no encuentra nada, deja lo que ya había.
  if (company.company_linkedin_url) {
    try {
      const sizes = await salvageEmployeeCounts([
        { name: company.company_name, linkedin_url: company.company_linkedin_url }
      ]);
      const fromLinkedin = sizes.get(company.company_name.toLowerCase().trim());
      if (typeof fromLinkedin === "number") {
        company = { ...company, company_size: fromLinkedin };
      }
    } catch {
      // best-effort; no rompemos el research si Perplexity falla acá.
    }
  }

  const offTarget = company.company_type === "other";
  return { company, not_found: false, off_target: offTarget, diagnostics };
}
