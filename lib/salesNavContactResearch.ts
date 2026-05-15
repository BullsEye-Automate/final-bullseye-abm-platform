// Research de UN contacto a partir de su URL de perfil de LinkedIn —
// Sprint 6 fase 4, módulo /sales-navigator.
//
// El usuario encuentra decision-makers en LinkedIn Sales Navigator y pega
// sus URLs de perfil. Esta función intenta sacar nombre + cargo con
// Perplexity + Claude para pre-llenar el formulario.
//
// Es best-effort: LinkedIn bloquea el scraping, así que la IA depende de
// que la persona tenga presencia pública en otras fuentes (sitio de la
// empresa, prensa, directorios). Si no encuentra nada, devuelve al menos
// un nombre tentativo sacado del slug de la URL, con found=false, para que
// el usuario complete a mano. La UI muestra los campos editables.

import type Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback } from "./claude";
import { perplexitySearch } from "./perplexity";

export type ContactDraft = {
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  found: boolean; // true si la IA encontró info real (no solo el slug de la URL)
  note: string | null; // diagnóstico corto para la UI
};

export function isLinkedinProfileUrl(u: string): boolean {
  return /linkedin\.com\/in\/[^/?#]+/i.test(u.trim());
}

// Extrae un nombre tentativo del slug de la URL de LinkedIn.
// linkedin.com/in/john-smith-1a2b3c → { first: "John", last: "Smith" }
function nameFromSlug(url: string): { first: string | null; last: string | null } {
  try {
    const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return { first: null, last: null };
    const slug = decodeURIComponent(m[1]);
    // Descartamos los tramos que parezcan hash (contienen dígitos).
    const parts = slug
      .split("-")
      .filter((p) => p && !/\d/.test(p) && p.length > 1);
    if (parts.length === 0) return { first: null, last: null };
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const first = cap(parts[0]);
    const last = parts.length > 1 ? parts.slice(1).map(cap).join(" ") : null;
    return { first, last };
  } catch {
    return { first: null, last: null };
  }
}

function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

const SYSTEM = `Eres analista de prospección B2B para weCAD4you (outsourcing de diseño CAD/CAM dental).

Tu tarea: a partir de una búsqueda web sobre UNA persona (identificada por su URL de LinkedIn y la empresa donde trabaja), extraer su nombre y cargo actual.

Reglas:
- Trabajás SOLO con la evidencia provista. No inventes. Lo que no esté en la evidencia, va en null.
- job_title: el cargo ACTUAL en la empresa indicada. Si la evidencia es ambigua, vieja, o de otra empresa, dejá job_title en null.
- linkedin_headline: el titular de LinkedIn si aparece literal en la evidencia; si no, null.
- found: true SOLO si la evidencia tiene info real y reconocible de esta persona (nombre confirmado y/o cargo). false si la búsqueda no devolvió nada útil.

Devolvé SIEMPRE JSON válido con esta forma exacta:
{ "found": boolean, "first_name": string|null, "last_name": string|null, "job_title": string|null, "linkedin_headline": string|null, "note": string|null }

note: 1 frase corta en español diciendo qué se encontró o por qué no, para que el usuario sepa si tiene que corregir a mano.`;

export async function researchContactFromLinkedin(input: {
  linkedin_url: string;
  company_name: string | null;
  company_type: string | null;
}): Promise<ContactDraft> {
  const url = input.linkedin_url.trim();
  const slugName = nameFromSlug(url);

  // Fallback si la IA no encuentra nada: al menos el nombre del slug.
  const fallback: ContactDraft = {
    linkedin_url: url,
    first_name: slugName.first,
    last_name: slugName.last,
    job_title: null,
    linkedin_headline: null,
    found: false,
    note: "La IA no pudo leer el perfil (LinkedIn bloquea scraping). Completá nombre y cargo a mano."
  };

  let research;
  try {
    research = await perplexitySearch({
      system:
        "Eres un asistente de research B2B. Investigá a la persona puntual que te piden con evidencia pública verificable (sitio de la empresa, prensa, directorios profesionales). Citá fuentes.",
      user: [
        `Investigá a esta persona y decime su nombre completo y su cargo ACTUAL.`,
        ``,
        `Perfil de LinkedIn: ${url}`,
        input.company_name ? `Trabaja en: ${input.company_name}` : "",
        slugName.first
          ? `Nombre tentativo (del slug de la URL): ${[slugName.first, slugName.last]
              .filter(Boolean)
              .join(" ")}`
          : "",
        ``,
        `Buscá: nombre completo, cargo o título actual en esa empresa, área. Citá la fuente de cada dato.`
      ]
        .filter(Boolean)
        .join("\n")
    });
  } catch {
    return fallback;
  }

  if (!research.content || research.content.trim().length < 20) return fallback;

  let parsed: any = null;
  try {
    const { message } = await createMessageWithFallback({
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Perfil de LinkedIn: ${url}
Empresa: ${input.company_name ?? "(desconocida)"}${
            input.company_type ? ` (${input.company_type})` : ""
          }
Nombre tentativo del slug: ${
            [slugName.first, slugName.last].filter(Boolean).join(" ") || "(ninguno)"
          }

Investigación de Perplexity:

${research.content}

---

Devolvé el JSON estricto definido en el sistema.`
        }
      ]
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    parsed = extractJson(text);
  } catch {
    return fallback;
  }

  if (!parsed) return fallback;

  const found = parsed.found === true;
  return {
    linkedin_url: url,
    first_name: (parsed.first_name ?? slugName.first) || null,
    last_name: (parsed.last_name ?? slugName.last) || null,
    job_title: parsed.job_title ?? null,
    linkedin_headline: parsed.linkedin_headline ?? null,
    found,
    note: parsed.note ?? (found ? null : fallback.note)
  };
}
