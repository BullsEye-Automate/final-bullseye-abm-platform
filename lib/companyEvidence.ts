// Helpers para validar que las señales operativas de una empresa tengan
// respaldo en evidencia específica (no en contexto genérico del rubro).
//
// Disparador (sesión 2026-05-15d, post PR #114): el diagnóstico de Elite
// Dental Lab probó que el discovery broad estaba alucinando señales
// operativas (software CAD, escáner, externalización, contratación) a
// partir de contexto genérico del rubro. Las 8 citas guardadas eran PDFs
// académicos del rubro, NINGUNA nombraba a Elite. Re-corriendo research
// HOY, Perplexity reportó "no hay información pública" en TODAS las
// categorías operativas.
//
// Regla operativa: una señal operativa solo es válida si existe una cita
// en research_sources que (a) literalmente nombre a esta empresa y (b)
// esté referenciada con [N] en la propia señal. Si no, se strippea.

import type { PerplexityCitation } from "./perplexity";

// Keywords que identifican afirmaciones operativas (vs descriptivas).
// Una señal operativa sin cita específica de la empresa es sospechosa.
// Conservador: si dudás, asumí operativa (strippeable).
const OPERATIONAL_KEYWORDS =
  /\b(exocad|inlab|3shape|dental wings|itero|medit|carestream|cerec|primescan|trios|hiring|hire|contratando|contrata|externaliz|outsourc|evident|full contour|aidite|automate|cam operator|cad operator|cad designer|expansion|expansión|funding|partner|case stud|tutorial|youtube|casos digitales|scanner|escáner|growth|launched|partnered|million|millones|empleado|employees? \d|workflows? digital|flujo digital confirmado)\b/i;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "&",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "y",
  "e",
  "en"
]);

// Saca las palabras significativas del nombre de una empresa (ignora artículos).
function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// Una cita "nombra" a una empresa si su title o URL contienen las primeras
// 2 palabras significativas del nombre (en orden, como substring). Ejemplo:
//   "Elite Dental Lab" → busca "elite dental" en title/URL.
//   "DLP Dental Laboratory" → busca "dlp dental".
// Si la empresa tiene una sola palabra significativa, esa sola debe aparecer.
export function citationNamesCompany(
  citation: PerplexityCitation | undefined,
  companyName: string
): boolean {
  if (!citation) return false;
  const words = significantWords(companyName);
  if (words.length === 0) return false;
  const needle = words.slice(0, Math.min(words.length, 2)).join(" ");
  const haystack = ((citation.title ?? "") + " " + (citation.url ?? "")).toLowerCase();
  return haystack.includes(needle);
}

export type EvidenceQuality = "specific" | "generic" | "none";

// Calidad de evidencia: cuántas citas nombran a la empresa.
//   "specific" → al menos una cita nombra a la empresa.
//   "generic"  → hay citas pero ninguna nombra a la empresa (contexto rubro).
//   "none"     → no hay citas.
export function evidenceQuality(
  companyName: string,
  sources: PerplexityCitation[] | null | undefined
): EvidenceQuality {
  const list = sources ?? [];
  if (list.length === 0) return "none";
  const hasSpecific = list.some((s) => citationNamesCompany(s, companyName));
  return hasSpecific ? "specific" : "generic";
}

// Recorre fit_signals (string separado por " · "), strippea afirmaciones
// operativas que no tengan [N] respaldando con una cita que nombre la
// empresa. Devuelve el string limpio + lista de items strippeados (para
// auditoría).
export function cleanFitSignals(
  fitSignals: string,
  companyName: string,
  sources: PerplexityCitation[] | null | undefined
): { cleaned: string; stripped: string[] } {
  if (!fitSignals || fitSignals.trim().length === 0) {
    return { cleaned: "", stripped: [] };
  }
  const list = sources ?? [];
  const parts = fitSignals
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const validated: string[] = [];
  const stripped: string[] = [];

  for (const part of parts) {
    const isOperational = OPERATIONAL_KEYWORDS.test(part);
    const citeMatches = Array.from(part.matchAll(/\[(\d+)\]/g)).map((m) => parseInt(m[1], 10));
    const cleanText = part.replace(/\s*\[\d+\]/g, "").trim();

    if (!isOperational) {
      validated.push(cleanText);
      continue;
    }
    // Operacional: necesita al menos una cita [N] que nombre a la empresa.
    let supported = false;
    for (const n of citeMatches) {
      const cite = list[n - 1]; // [N] es 1-indexed sobre research_sources
      if (citationNamesCompany(cite, companyName)) {
        supported = true;
        break;
      }
    }
    if (supported) {
      validated.push(cleanText);
    } else {
      stripped.push(part);
    }
  }

  return { cleaned: validated.join(" · "), stripped };
}

// Aplica el régimen estricto de evidencia a una empresa extraída:
//   - Strippea operational signals sin cita que nombre a la empresa.
//   - Si NO hay ninguna cita específica → nulea cad_software,
//     scanner_technology, competitor_match (todo operativo es sospechoso
//     sin respaldo específico) y degrada fit_score a "low".
//   - Si hay cita específica pero los campos operativos no tenían señal
//     respaldatoria → los nulea individualmente (cad_software solo se
//     mantiene si la señal correspondiente sobrevivió).
//
// Principio rector: prefiero honestidad sobre completitud. Una tarjeta
// con "no hay info pública digital" es 1000x mejor que una tarjeta con
// datos inventados.
export type ValidationOutcome = {
  evidence_quality: EvidenceQuality;
  stripped_signals: string[];
  fit_score_was: "high" | "medium" | "low";
  nulled_operational_fields: boolean;
};

export function validateCompanyEvidence<
  T extends {
    company_name: string;
    fit_signals: string;
    fit_score: "high" | "medium" | "low";
    cad_software: string | null;
    scanner_technology: string | null;
    competitor_match: string | null;
    research_sources: PerplexityCitation[];
  }
>(c: T): { company: T; outcome: ValidationOutcome } {
  const quality = evidenceQuality(c.company_name, c.research_sources);
  const fitScoreWas = c.fit_score;

  const { cleaned, stripped } = cleanFitSignals(
    c.fit_signals,
    c.company_name,
    c.research_sources
  );

  // Cuando no hay evidencia específica, nuleamos TODO lo operativo y bajamos
  // el score: la empresa puede ser real (Perplexity dice "existe") pero las
  // afirmaciones sobre software/escáner/externalización son sospechosas.
  let fit_score = c.fit_score;
  let cad_software = c.cad_software;
  let scanner_technology = c.scanner_technology;
  let competitor_match = c.competitor_match;
  let nulledOperational = false;

  if (quality === "none" || quality === "generic") {
    fit_score = "low";
    cad_software = null;
    scanner_technology = null;
    competitor_match = null;
    nulledOperational = true;
  } else {
    // Tenemos al menos una cita específica. Validación granular: si una
    // señal sobre cad_software / scanner / competidor fue strippeada del
    // fit_signals (por falta de cita específica para ese hecho puntual),
    // también nuleamos el campo correspondiente.
    const strippedText = stripped.join(" ").toLowerCase();
    if (cad_software && strippedText.includes(cad_software.toLowerCase().split(/\s+/)[0])) {
      cad_software = null;
      nulledOperational = true;
    }
    if (
      scanner_technology &&
      strippedText.includes(scanner_technology.toLowerCase().split(/\s+/)[0])
    ) {
      scanner_technology = null;
      nulledOperational = true;
    }
    if (competitor_match && strippedText.includes(competitor_match.toLowerCase())) {
      competitor_match = null;
      nulledOperational = true;
    }
  }

  return {
    company: {
      ...c,
      fit_signals: cleaned,
      fit_score,
      cad_software,
      scanner_technology,
      competitor_match
    },
    outcome: {
      evidence_quality: quality,
      stripped_signals: stripped,
      fit_score_was: fitScoreWas,
      nulled_operational_fields: nulledOperational
    }
  };
}
