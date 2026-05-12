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
  size_min: number;
  size_max: number | null;
  size_note?: string | null;
  limit: number;
  exclude: string[];
  // Pedir a Perplexity más empresas que el limite final, para que los filtros
  // de abajo tengan colchón. Por ejemplo overshoot=2 pide 2*limit a Perplexity
  // y devuelve hasta `limit` filtradas.
  overshoot?: number;
  // Verificación HTTP de cada LinkedIn URL. Cuando es false, solo el regex.
  verify_linkedin_live?: boolean;
  // Cuando es false, no se aplica el filtro estricto de país (solo el prompt
  // ya le pide a Claude que respete la región).
  strict_region?: boolean;
};

export type DiscoveryDiagnostics = {
  perplexity_asked: number;
  perplexity_content_chars: number;
  perplexity_content_preview: string;
  claude_extracted: number;
  passed_name: number;
  passed_dedup: number;
  passed_linkedin_regex: number;
  passed_region: number;
  passed_linkedin_live: number;
  final: number;
  verify_linkedin_live: boolean;
  strict_region: boolean;
};

export type DiscoverResult = {
  companies: DiscoveredCompany[];
  diagnostics: DiscoveryDiagnostics;
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
Tu trabajo es extraer empresas reales que aparezcan en la investigación web entregada, dejando que el sistema posterior filtre las que no cumplen el ICP.

Reglas de extracción:
- Trabajas ÚNICAMENTE con la evidencia provista. No inventes empresas ni señales. Si la evidencia no menciona algo, déjalo en null.
- Extrae TODA empresa que la evidencia mencione como laboratorio dental, clínica multi-centro o DSO, aunque falten campos. El filtrado fino (LinkedIn URL válida, país, tamaño) lo hace el código después; tu trabajo es no perder candidatos en este paso.
- Una empresa califica si: es lab / multi-centro / DSO + tiene evidencia de flujo digital + tiene volumen real (no 1–2 personas).
- Si la empresa ya externaliza con un competidor (Evident, Full Contour, Aidite, Automate by 3Shape), márcala como "high" y rellena competitor_match.
- Tener diseñadores propios NO descarta — es señal de que entienden el valor.
- Tamaño de empresa: estima en empleados. Si la evidencia da un rango, usa el punto medio. Si no hay tamaño, deja null (no descartes por eso).
- company_linkedin_url: si la evidencia trae la URL corporativa de LinkedIn (formato https://www.linkedin.com/company/<slug>), inclúyela LITERAL. Si no la trae, deja null — NO la inventes ni construyas desde el nombre, pero TAMPOCO descartes la empresa por eso.
- company_country: usa el código ISO de 2 letras cuando puedas inferirlo de la evidencia (US, CA, MX, GB, etc.). Si no puedes inferirlo, deja null (no descartes por eso).
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

function renderSizeHint(min: number, max: number | null, note?: string | null): string {
  const range = max === null ? `${min}+` : `${min}–${max}`;
  const noteStr = note ? ` — ${note}` : "";
  return `labs, clínicas multi-centro y DSOs con ${range} empleados${noteStr}`;
}

const REGION_LABEL: Record<string, string> = {
  US: "Estados Unidos",
  CA: "Canadá",
  EU: "Europa",
  LATAM: "Latinoamérica"
};

// Strict region validation. For single-country regions (US, CA) we enforce the
// country at parse-time; for multi-country regions (EU, LATAM) we trust the
// prompt because validating against the full list is brittle.
const REGION_COUNTRIES: Record<string, string[]> = {
  US: ["us", "u.s.", "u.s.a.", "usa", "united states", "united states of america", "estados unidos"],
  CA: ["ca", "canada", "canadá"]
};

function isInStrictRegion(region: string, country: string | null | undefined): boolean {
  const allowed = REGION_COUNTRIES[region];
  if (!allowed) return true; // EU/LATAM: prompt-only enforcement
  if (!country) return false;
  return allowed.includes(country.toLowerCase().trim());
}

export async function discoverCompanies(opts: DiscoverOpts): Promise<DiscoverResult> {
  const { icp, region, size_min, size_max, size_note, limit, exclude } = opts;
  const overshoot = Math.max(1, opts.overshoot ?? 2);
  const verifyLinkedinLive = opts.verify_linkedin_live ?? true;
  const strictRegion = opts.strict_region ?? true;
  const ask = Math.min(limit * overshoot, 30);

  // 1) Perplexity research
  const regionLabel = REGION_LABEL[region] ?? region;
  const sizeHint = renderSizeHint(size_min, size_max, size_note);
  const competitors = icp.competitors.map((c) => c.name).join(", ");
  const excludeBlock = exclude.length
    ? `\n\nNO incluyas estas empresas (ya están en la base):\n${exclude.map((n) => `- ${n}`).join("\n")}`
    : "";

  const perplexityUser = `Busca ${ask} laboratorios dentales, clínicas multi-centro o DSOs basados en ${regionLabel} que muestren señales de flujos digitales CAD/CAM dental. Perfil deseado: ${sizeHint}.

Para cada empresa, devuelve los datos que encuentres en fuentes públicas. No descartes empresas si te falta algún dato — el sistema posterior filtra.

Datos que necesito por empresa:
- Nombre exacto de la empresa (obligatorio)
- Ubicación: ciudad y estado/región
- URL de LinkedIn corporativo en formato https://www.linkedin.com/company/<slug>, SOLO si aparece literal en la fuente. NO la construyas a partir del nombre, NO la inventes. Si no la encuentras, déjala en blanco e inclúyela igual.
- Sitio web oficial si está disponible
- Tamaño aproximado en empleados si la fuente lo trae
- Software CAD que mencionan (exocad, inLab, 3Shape, Dental Wings)
- Escáner intraoral que usan (iTero, Medit, Carestream, Cerec)
- Si externalizan diseño CAD con alguno de estos competidores: ${competitors}
- Señales activas: contratando técnico CAD, publican casos digitales, expansión

Estrategia de búsqueda:
- Mira directorios públicos de labs dentales en ${regionLabel}, perfiles de LinkedIn de empresas, web corporativas con sección "About" o "Technology", notas de prensa sobre expansión o adopción de software CAD.
- Busca también empresas que aparezcan en listas tipo "Top dental laboratories in [estado/región]", reviews de software CAD dental, casos de éxito de fabricantes de escáneres.
- Diversifica entre varios estados/regiones para no concentrar todo en un solo lugar.

Cita la fuente de cada empresa con [N].${excludeBlock}`;

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

A partir de esa evidencia, extrae hasta ${ask} empresas que cumplan el ICP vigente. Devuelve JSON estricto como se definió en el sistema. Si no encuentras suficientes empresas válidas, devuelve menos — nunca inventes.`
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

  // Pipeline de filtros — registrar cuántas empresas sobreviven a cada paso
  // para mostrar el funnel en la UI.
  const excludeSet = new Set(exclude.map((n) => n.toLowerCase().trim()));

  const namedOnly = companies.filter((c) => c.company_name.length > 0);
  const dedupOnly = namedOnly.filter((c) => !excludeSet.has(c.company_name.toLowerCase().trim()));
  const regexOnly = dedupOnly.filter((c) => isValidLinkedinCompanyUrl(c.company_linkedin_url));
  const regionOnly = strictRegion
    ? regexOnly.filter((c) => isInStrictRegion(region, c.company_country))
    : regexOnly;

  let liveOnly: DiscoveredCompany[];
  if (verifyLinkedinLive) {
    const liveness = await Promise.all(
      regionOnly.map((c) => isLiveLinkedinCompanyUrl(c.company_linkedin_url!))
    );
    liveOnly = regionOnly.filter((_, i) => liveness[i]);
  } else {
    liveOnly = regionOnly;
  }

  // Cortamos a `limit` tras filtrar (el overshoot solo era buffer).
  const final = liveOnly.slice(0, limit);

  const diagnostics: DiscoveryDiagnostics = {
    perplexity_asked: ask,
    perplexity_content_chars: research.content.length,
    perplexity_content_preview: research.content.slice(0, 600),
    claude_extracted: companies.length,
    passed_name: namedOnly.length,
    passed_dedup: dedupOnly.length,
    passed_linkedin_regex: regexOnly.length,
    passed_region: regionOnly.length,
    passed_linkedin_live: liveOnly.length,
    final: final.length,
    verify_linkedin_live: verifyLinkedinLive,
    strict_region: strictRegion
  };

  return { companies: final, diagnostics };
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
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": LINKEDIN_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(LINKEDIN_VERIFY_TIMEOUT_MS)
    });
    if (res.url.toLowerCase().includes("/company/unavailable")) return false;
    if (res.status === 404 || res.status === 410) return false;
    return true;
  } catch {
    // Network error / timeout / bot-block (LinkedIn often returns 999 or hangs).
    // Be permissive: better to ship a borderline one than drop a real one for
    // transient infra reasons.
    return true;
  }
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

