// Extracción de contactos desde el sitio web de una empresa. Sprint 5 fase 6.
//
// Caso de uso: muchos laboratorios dentales tradicionales / familiares tienen
// a su equipo publicado en la web (página "Our Team" / "Leadership" / "About")
// pero casi no usan LinkedIn — así que Clay Find People rinde cero. Esta ruta
// scrapea la página de equipo del sitio y extrae las personas con su cargo,
// email y teléfono, que vienen públicos en la propia web de la empresa.
//
// Los contactos extraídos pasan después por el pre-filter de siempre
// (intakeContactsForCompany) — esto solo se encarga del scraping + extracción.

import type Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback } from "./claude";
import { perplexitySearch } from "./perplexity";
import type { RawContact } from "./contactsIntake";

export type ScrapeContactsResult = {
  contacts: RawContact[];
  diagnostics: {
    perplexity_content_chars: number;
    claude_model_used: string;
    claude_response_preview: string;
  };
};

const SYSTEM_SCRAPE = `Eres un asistente de extracción de contactos B2B. Tu tarea: a partir del contenido público del sitio web de una empresa (página de equipo / liderazgo / "about" / "contact"), extraer las personas que aparezcan nombradas.

Reglas:
- Trabajás SOLO con la evidencia provista. No inventes personas, cargos, emails ni teléfonos. Lo que no esté, va en null.
- Extraé TODA persona nombrada con un cargo en la empresa: dueños, C-level, directores, gerentes, líderes de área, técnicos senior. NO extraigas testimonios de clientes ni nombres de pacientes.
- Separá el nombre completo en first_name y last_name lo mejor que puedas.
- email: literal de la evidencia. Si la web muestra el email ofuscado o no lo muestra, null.
- phone: literal de la evidencia (puede ser el teléfono general de la empresa con extensión — incluilo igual).
- job_title: el cargo tal como aparece en la web.
- linkedin_url: solo si la web linkea al perfil personal de LinkedIn de esa persona. Si no, null.
- Si la página no es de equipo o no hay personas nombradas, devolvé un array vacío.

Devolvé SIEMPRE JSON válido con esta forma exacta:
{
  "contacts": [
    {
      "first_name": string | null,
      "last_name": string | null,
      "job_title": string | null,
      "email": string | null,
      "phone": string | null,
      "linkedin_url": string | null
    }
  ]
}`;

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

export async function scrapeCompanyContacts(input: {
  company_name: string;
  company_website: string;
}): Promise<ScrapeContactsResult> {
  const { company_name, company_website } = input;

  // 1) Perplexity busca y lee la página de equipo del sitio.
  const research = await perplexitySearch({
    system:
      "Eres un asistente de research B2B. Tu tarea es encontrar y leer la página de equipo / liderazgo / 'about us' / 'contact' del sitio web de una empresa y reportar las personas que aparecen ahí con su cargo, email y teléfono.",
    user: `Empresa: ${company_name}
Sitio web: ${company_website}

Buscá dentro de ese sitio web la página de equipo / liderazgo / "Our Team" / "Leadership" / "About Us" / "Meet the Team" / "Contact".

Listá TODAS las personas que aparezcan nombradas trabajando en la empresa, con estos datos para cada una (los que estén publicados):
- Nombre completo
- Cargo / título
- Email
- Teléfono (incluí extensión si la hay)
- Link a su perfil personal de LinkedIn (solo si la web lo linkea)

NO incluyas testimonios de clientes ni nombres de pacientes — solo gente del equipo de la empresa.
Si no encontrás una página de equipo o no hay personas nombradas, decilo explícitamente.
Citá la URL exacta de donde sacaste cada dato.`
  });

  // 2) Claude estructura la extracción.
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 4096,
    system: SYSTEM_SCRAPE,
    messages: [
      {
        role: "user",
        content: `Empresa: ${company_name}
Sitio web: ${company_website}

Contenido encontrado en el sitio (con citas [1], [2], ...):

${research.content}

---

Extraé las personas del equipo en el JSON estricto definido en el sistema.`
      }
    ]
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text);
  const contacts: RawContact[] = Array.isArray(parsed?.contacts)
    ? parsed.contacts
        .map((c: any) => ({
          first_name: c.first_name ?? null,
          last_name: c.last_name ?? null,
          job_title: c.job_title ?? null,
          linkedin_headline: null,
          linkedin_url: c.linkedin_url ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          seniority: null,
          tenure: null
        }))
        .filter((c: RawContact) => c.first_name || c.last_name || c.email)
    : [];

  return {
    contacts,
    diagnostics: {
      perplexity_content_chars: research.content.length,
      claude_model_used: model_used,
      claude_response_preview: text.slice(0, 600)
    }
  };
}
