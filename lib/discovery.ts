import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./claude";
import { perplexitySearch, PerplexityCitation } from "./perplexity";
import type { IcpConfig } from "./supabase";

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
  icp: IcpConfig;
  region: string;
  size: "small" | "medium" | "large";
  limit: number;
  exclude: string[];
};

function renderIcpPrompt(icp: IcpConfig): string {
  const acceptedOrgs = icp.org_types.filter((o) => o.accept);
  const rejectedOrgs = icp.org_types.filter((o) => !o.accept);
  return [
    "# weCAD4you · ICP vigente",
    "",
    `Versión del ICP: ${icp.version}`,
    "",
    "## Tipos de organización aceptados",
    acceptedOrgs.map((o) => `- ${o.label}${o.note ? ` — ${o.note}` : ""}`).join("\n"),
    "",
    "## Tipos de organización descartados",
    rejectedOrgs.map((o) => `- ${o.label}`).join("\n"),
    "",
    "## Señales digitales fuertes (1 sola es suficiente)",
    icp.signals_strong.map((s) => `- ${s}`).join("\n"),
    "",
    "## Señales digitales medias (necesito 2+ para aprobar)",
    icp.signals_medium.map((s) => `- ${s}`).join("\n"),
    "",
    "## Reglas de volumen por número de empleados",
    icp.size_rules
      .map((r) => {
        const range = r.max === null ? `${r.min}+` : `${r.min}–${r.max}`;
        return `- ${range} → ${r.decision}${r.note ? ` (${r.note})` : ""}`;
      })
      .join("\n"),
    "",
    "## Competidores a monitorear (señal de fit inmediata si ya externalizan con ellos)",
    icp.competitors.map((c) => `- ${c.name}${c.note ? ` — ${c.note}` : ""}`).join("\n"),
    "",
    "## Notas",
    icp.notes
  ].join("\n");
}

const SYSTEM_DISCOVERY = `Eres analista de prospección B2B para weCAD4you, un servicio de outsourcing de diseño CAD/CAM dental.
Tu trabajo es identificar empresas reales que cumplen el ICP, basándote en la investigación web que se te entregará.

Reglas:
- Trabajas ÚNICAMENTE con la evidencia provista. No inventes empresas ni señales. Si la evidencia no menciona algo, déjalo en null.
- Una empresa califica si: es lab / multi-centro / DSO + tiene evidencia de flujo digital + tiene volumen real (no 1–2 personas).
- Si la empresa ya externaliza con un competidor (Evident, Full Contour, Aidite, Automate by 3Shape), márcala como "high" y rellena competitor_match.
- Tener diseñadores propios NO descarta — es señal de que entienden el valor.
- Tamaño de empresa: estima en empleados. Si la evidencia da un rango, usa el punto medio.
- REQUISITO DURO — company_linkedin_url: solo incluye la empresa si la evidencia trae una URL verificable de su página corporativa de LinkedIn (formato exacto https://www.linkedin.com/company/<slug>). NUNCA construyas el slug a partir del nombre, NUNCA adivines. Si la evidencia no la trae, descarta la empresa antes de devolverla.
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
      "company_type": "lab" | "multi_clinic" | "dso" | "other",
      "cad_software": string | null,
      "scanner_technology": string | null,
      "fit_signals": string,
      "fit_score": "high" | "medium" | "low",
      "competitor_match": string | null,
      "research_summary": string
    }
  ]
}
fit_signals: una lista corta y concreta de las señales detectadas, separadas por " · ".
research_summary: 2–3 frases explicando por qué califica esta empresa según el ICP.`;

const SIZE_HINT: Record<DiscoverOpts["size"], string> = {
  small:  "labs y clínicas con 5–30 empleados (sweet spot, dueño decide)",
  medium: "labs y clínicas con 31–100 empleados",
  large:  "labs grandes, DSOs y grupos de 100+ empleados con flujo digital"
};

const REGION_LABEL: Record<string, string> = {
  US: "Estados Unidos",
  CA: "Canadá",
  EU: "Europa",
  LATAM: "Latinoamérica"
};

export async function discoverCompanies(opts: DiscoverOpts): Promise<DiscoveredCompany[]> {
  const { icp, region, size, limit, exclude } = opts;

  // 1) Perplexity research
  const regionLabel = REGION_LABEL[region] ?? region;
  const sizeHint = SIZE_HINT[size];
  const competitors = icp.competitors.map((c) => c.name).join(", ");
  const excludeBlock = exclude.length
    ? `\n\nNO incluyas estas empresas (ya están en la base):\n${exclude.map((n) => `- ${n}`).join("\n")}`
    : "";

  const perplexityUser = `Busca ${limit} laboratorios dentales, clínicas multi-centro o DSOs en ${regionLabel}, perfil "${sizeHint}", que muestren evidencia pública de flujo digital CAD/CAM dental.

Para cada empresa, encuentra OBLIGATORIAMENTE:
- Nombre exacto
- URL de LinkedIn corporativo (formato https://www.linkedin.com/company/<slug>) — REQUERIDA y copiada literal de la fuente, no construida desde el nombre. Si no la puedes verificar en una fuente real, descarta la empresa.
- Sitio web oficial (solo si aparece literal en la fuente)

Datos adicionales si están:
- Ciudad / país
- Tamaño aproximado en empleados (LinkedIn o web)
- Software CAD que mencionan (exocad, inLab, 3Shape, Dental Wings)
- Escáner intraoral que usan (iTero, Medit, Carestream, Cerec)
- Si externalizan diseño CAD con alguno de estos competidores: ${competitors}
- Señales activas: contratando técnico CAD, publican casos digitales, expansión

Prioriza empresas con presencia verificable en LinkedIn. No inventes URLs.${excludeBlock}`;

  const research = await perplexitySearch({
    system:
      "Eres un asistente de research B2B. Busca evidencia pública verificable sobre laboratorios dentales y clínicas. Cita fuentes.",
    user: perplexityUser
  });

  // 2) Claude structured extraction
  // Cache the ICP rendering (stable across requests) so subsequent runs are cheap.
  const icpRendered = renderIcpPrompt(icp);

  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_DISCOVERY },
      {
        type: "text",
        text: icpRendered,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
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

  const parsed = extractJson(text);
  const companies: DiscoveredCompany[] = Array.isArray(parsed?.companies)
    ? parsed.companies.map((c: any) => ({
        company_name: String(c.company_name ?? "").trim(),
        company_website: c.company_website ?? null,
        company_linkedin_url: c.company_linkedin_url ?? null,
        company_city: c.company_city ?? null,
        company_country: c.company_country ?? null,
        company_size: typeof c.company_size === "number" ? c.company_size : null,
        company_type: ["lab", "multi_clinic", "dso", "other"].includes(c.company_type)
          ? c.company_type
          : "other",
        cad_software: c.cad_software ?? null,
        scanner_technology: c.scanner_technology ?? null,
        fit_signals: String(c.fit_signals ?? ""),
        fit_score: ["high", "medium", "low"].includes(c.fit_score) ? c.fit_score : "medium",
        competitor_match: c.competitor_match ?? null,
        research_summary: String(c.research_summary ?? ""),
        research_sources: research.citations
      }))
    : [];

  // Drop anything missing a name, missing a verifiable LinkedIn company URL,
  // or already in the exclude list. The LinkedIn requirement protects the
  // downstream Clay "Find People" step, which can only find contacts if the
  // company has a real LinkedIn page.
  const excludeSet = new Set(exclude.map((n) => n.toLowerCase().trim()));
  return companies.filter((c) => {
    if (c.company_name.length === 0) return false;
    if (excludeSet.has(c.company_name.toLowerCase().trim())) return false;
    if (!isValidLinkedinCompanyUrl(c.company_linkedin_url)) return false;
    return true;
  });
}

const LINKEDIN_COMPANY_URL_RE =
  /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9._%-]+\/?$/i;

export function isValidLinkedinCompanyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return LINKEDIN_COMPANY_URL_RE.test(url.trim());
}

function extractJson(text: string): any {
  // Tolerate code fences and surrounding prose.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: find first {...} block
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

