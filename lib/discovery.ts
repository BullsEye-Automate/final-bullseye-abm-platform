import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./claude";
import { perplexitySearch, PerplexityCitation } from "./perplexity";
import { normalizeLinkedInUrl } from "./normalizeLinkedIn";

export type DiscoveredCompany = {
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: "lab" | "multi_clinic" | "dso" | "other";
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string;
  fit_score: "high" | "medium" | "low";
  competitor_match: string | null;
  research_summary: string;
  research_sources: PerplexityCitation[];
};

type DiscoverOpts = {
  icpContent: string;
  region: string;
  size?: "small" | "medium" | "large";
  sizeHint?: string | null;   // si se provee, reemplaza size en el prompt
  limit: number;
  exclude: string[];
};

// Extrae el valor de un campo [Etiqueta] del texto del ICP serializado
function extractIcpField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[${escaped}\\]\\s*([\\s\\S]*?)(?=\\n\\[|\\n-{3,}|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

// Construye descripción de empresa objetivo para la query de Perplexity
function extractCompanyProfile(icpContent: string): string {
  const tipo       = extractIcpField(icpContent, "Tipo de empresa objetivo");
  const industrias = extractIcpField(icpContent, "Industrias objetivo");
  const tecnologias = extractIcpField(icpContent, "Tecnologías / Stack que usa");
  const descripcion = extractIcpField(icpContent, "Descripción del negocio");

  const parts: string[] = [];
  if (tipo)        parts.push(`Tipo: ${tipo}`);
  if (industrias)  parts.push(`Industrias: ${industrias}`);
  if (tecnologias) parts.push(`Tecnologías/Stack: ${tecnologias}`);
  if (descripcion && parts.length === 0) parts.push(descripcion);
  return parts.length > 0 ? parts.join(". ") : "empresas B2B";
}

// Extrae competidores del ICP para señal de fit inmediata
function extractCompetitors(icpContent: string): string {
  const comp = extractIcpField(icpContent, "Competidores principales");
  if (!comp) return "";
  return comp.split(/\n/)[0].trim();
}

const SYSTEM_DISCOVERY = `Eres analista de prospección B2B para BullsEye, una agencia especializada en prospección B2B.
Tu trabajo es identificar empresas reales que cumplen el ICP del cliente, basándote en la investigación web que se te entregará.

Reglas:
- Trabajas ÚNICAMENTE con la evidencia provista. No inventes empresas ni señales. Si la evidencia no menciona algo, déjalo en null.
- Una empresa califica si cumple el perfil del ICP (tipo de empresa, industria, tamaño) y hay evidencia real de fit.
- Si la empresa ya trabaja con un competidor mencionado en el ICP, márcala como "high" y rellena competitor_match.
- Tamaño de empresa: estima en empleados. Si la evidencia da un rango, usa el punto medio.
- REQUISITO DURO — company_linkedin_url: solo incluye la empresa si la evidencia trae una URL verificable de su página corporativa de LinkedIn (formato exacto https://www.linkedin.com/company/<slug>). NUNCA construyas el slug a partir del nombre, NUNCA adivines. Si la evidencia no la trae, descarta la empresa antes de devolverla.
- REQUISITO DURO — company_country: debe coincidir con la región solicitada por el usuario. Si la empresa está fuera de esa región, descártala antes de devolverla. Usa el código ISO de 2 letras cuando sea posible (US, CA, MX, GB, DE, etc.).
- company_website: si lo incluyes, debe estar literal en la evidencia. Si dudas, déjalo en null antes que inventar.
Devuelve SIEMPRE JSON válido con esta forma exacta:
{
  "companies": [
    {
      "company_name": string,
      "company_website": string | null,
      "company_linkedin_url": string | null,
      "company_city": string | null,
      "company_country": string | null,
      "company_size": number | null,
      "company_type": "other",
      "fit_signals": string,
      "fit_score": "high" | "medium" | "low",
      "competitor_match": string | null,
      "research_summary": string
    }
  ]
}
fit_signals: una lista corta y concreta de las señales de fit detectadas, separadas por " · ".
research_summary: 2–3 frases explicando por qué califica esta empresa según el ICP.
competitor_match: si la empresa ya trabaja con un competidor mencionado en el ICP, indícalo aquí. Si no, null.`;

const SIZE_HINT: Record<"small" | "medium" | "large", string> = {
  small:  "empresas con 5–30 empleados (sweet spot, dueño decide)",
  medium: "empresas con 31–100 empleados",
  large:  "empresas grandes o grupos con 100+ empleados"
};

const REGION_LABEL: Record<string, string> = {
  US:    "Estados Unidos",
  CA:    "Canadá",
  EU:    "Europa",
  LATAM: "Latinoamérica"
};

// Para regiones de un solo país aplicamos validación estricta de country.
// Para EU/LATAM confiamos en el prompt porque validar contra la lista completa es frágil.
const REGION_COUNTRIES: Record<string, string[]> = {
  US: ["us", "u.s.", "u.s.a.", "usa", "united states", "united states of america", "estados unidos"],
  CA: ["ca", "canada", "canadá"]
};

function isInStrictRegion(region: string, country: string | null | undefined): boolean {
  const allowed = REGION_COUNTRIES[region];
  if (!allowed) return true;
  if (!country) return false;
  return allowed.includes(country.toLowerCase().trim());
}

export async function discoverCompanies(opts: DiscoverOpts): Promise<DiscoveredCompany[]> {
  const { icpContent, region, limit, exclude } = opts;

  // 1) Research con Perplexity — query dinámica basada en el ICP del cliente
  const regionLabel    = REGION_LABEL[region] ?? region;
  const resolvedSize   = opts.sizeHint !== undefined
    ? opts.sizeHint
    : SIZE_HINT[opts.size ?? "small"];
  const companyProfile = extractCompanyProfile(icpContent);
  const competitors    = extractCompetitors(icpContent);
  const excludeBlock   = exclude.length
    ? `\n\nNO incluyas estas empresas (ya están en la base):\n${exclude.map((n) => `- ${n}`).join("\n")}`
    : "";

  const competitorsLine = competitors
    ? `\n- Si externalizan o trabajan con alguno de estos competidores: ${competitors}`
    : "";

  const sizeHintLine   = resolvedSize ? `, perfil "${resolvedSize}"` : "";
  const perplexityUser = `Busca ${limit} empresas ÚNICAMENTE en ${regionLabel}${sizeHintLine}.

Perfil del cliente ideal: ${companyProfile}

REQUISITO GEOGRÁFICO DURO: descarta cualquier empresa fuera de ${regionLabel}. No incluyas empresas de otras regiones aunque hagan match con el resto del perfil.

Para cada empresa, encuentra OBLIGATORIAMENTE:
- Nombre exacto
- País — debe ser ${regionLabel}. Si no puedes confirmar el país, descarta la empresa.
- URL de LinkedIn corporativo (formato https://www.linkedin.com/company/<slug>) — REQUERIDA y copiada literal de la fuente, no construida desde el nombre. Si no la puedes verificar en una fuente real, descarta la empresa.
- Sitio web oficial (solo si aparece literal en la fuente)

Datos adicionales si están disponibles:
- Ciudad / país
- Tamaño aproximado en empleados (LinkedIn o web)
- Tecnologías o stack que usan${competitorsLine}
- Señales de crecimiento: contratando, expansión, nuevos productos, inversión reciente

Prioriza empresas con presencia verificable en LinkedIn. No inventes URLs.${excludeBlock}`;

  const research = await perplexitySearch({
    system: "Eres un asistente de research B2B. Busca evidencia pública verificable sobre empresas. Cita fuentes.",
    user:   perplexityUser
  });

  // 2) Claude extrae estructura — usa el ICP del cliente como contexto cacheado
  const message = await anthropic().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_DISCOVERY },
      {
        type:          "text",
        text:          `# ICP del cliente\n\n${icpContent}`,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role:    "user",
        content: `Investigación de Perplexity (con citas indexadas tipo [1], [2]):

${research.content}

---

A partir de esa evidencia, extrae hasta ${limit} empresas que cumplan el ICP vigente. Devuelve JSON estricto como se definió en el sistema. Si no encuentras suficientes empresas válidas, devuelve menos — nunca inventes.`
      }
    ]
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed    = extractJson(text);
  const companies: DiscoveredCompany[] = Array.isArray(parsed?.companies)
    ? parsed.companies.map((c: any) => ({
        company_name:         String(c.company_name ?? "").trim(),
        company_website:      c.company_website ?? null,
        company_linkedin_url: normalizeLinkedInUrl(c.company_linkedin_url),
        company_city:         c.company_city ?? null,
        company_country:      c.company_country ?? null,
        company_size:         typeof c.company_size === "number" ? c.company_size : null,
        company_type:         ["lab", "multi_clinic", "dso", "other"].includes(c.company_type)
          ? c.company_type
          : "other",
        fit_signals:          String(c.fit_signals ?? ""),
        fit_score:            ["high", "medium", "low"].includes(c.fit_score) ? c.fit_score : "medium",
        competitor_match:     c.competitor_match ?? null,
        research_summary:     String(c.research_summary ?? ""),
        research_sources:     research.citations
      }))
    : [];

  const excludeSet    = new Set(exclude.map((n) => n.toLowerCase().trim()));
  const formatFiltered = companies.filter((c) => {
    if (c.company_name.length === 0) return false;
    if (excludeSet.has(c.company_name.toLowerCase().trim())) return false;
    if (!isValidLinkedinCompanyUrl(c.company_linkedin_url)) return false;
    if (!isInStrictRegion(region, c.company_country)) return false;
    return true;
  });

  // Verifica que cada URL de LinkedIn esté viva (LinkedIn redirige slugs inválidos
  // a /company/unavailable/, lo que detecta tanto empresas inventadas como slugs incorrectos).
  const liveness = await Promise.all(
    formatFiltered.map((c) => isLiveLinkedinCompanyUrl(c.company_linkedin_url!))
  );
  return formatFiltered.filter((_, i) => liveness[i]);
}

const LINKEDIN_COMPANY_URL_RE =
  /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._%-]+\/?$/i;

export function isValidLinkedinCompanyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return LINKEDIN_COMPANY_URL_RE.test(url.trim());
}

const LINKEDIN_VERIFY_TIMEOUT_MS = 6000;
const LINKEDIN_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function isLiveLinkedinCompanyUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method:   "GET",
      redirect: "follow",
      headers: {
        "User-Agent":      LINKEDIN_USER_AGENT,
        Accept:            "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(LINKEDIN_VERIFY_TIMEOUT_MS)
    });
    if (res.url.toLowerCase().includes("/company/unavailable")) return false;
    if (res.status === 404 || res.status === 410) return false;
    return true;
  } catch {
    // Error de red / timeout / bloqueo de bot (LinkedIn devuelve 999 o cuelga).
    // Somos permisivos: mejor enviar una borderline que descartar una real por razones transitorias.
    return true;
  }
}

function extractJson(text: string): any {
  const fence     = text.match(/```(?:json)?\s*([\s\S]*?)```/);
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
