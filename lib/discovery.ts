import type Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback } from "./claude";
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
  // Cuando es true (default), corre un paso extra de Perplexity para
  // resolver LinkedIn URLs de empresas buen-fit que Claude dejó sin URL.
  salvage_linkedin?: boolean;
};

export type DiscoveryDiagnostics = {
  perplexity_asked: number;
  perplexity_content_chars: number;
  perplexity_content_preview: string;
  claude_model_used: string;
  claude_response_chars: number;
  claude_response_preview: string;
  claude_extracted: number;
  passed_name: number;
  passed_dedup: number;
  passed_fit: number;
  salvaged_linkedin: number;
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
- Extrae empresas que la evidencia mencione como laboratorio dental, clínica multi-centro o DSO, aunque falten campos. El filtrado fino (LinkedIn URL válida, país, tamaño) lo hace el código después; tu trabajo es no perder candidatos válidos en este paso.
- **NO extraigas** (estos NO son nuestro target y ensucian la cola de revisión):
  - Distribuidores de insumos o equipos dentales.
  - Fabricantes de equipos, materiales o software dental.
  - Proveedores, mayoristas, consultoras, agencias.
  - Centros de fresado que solo venden equipos sin operar como laboratorio.
  - Empresas de OTRAS industrias (biotecnología, agro, farma, etc.) — aunque el nombre tenga la palabra "lab".
  Si una empresa NO es claramente un laboratorio dental, una clínica dental multi-centro o un DSO que opera como tal, NO la incluyas en absoluto. No uses "other" como cajón de sastre: si no encaja en lab/multi_clinic/dso, omitila.
- Una empresa califica si: es lab / multi-centro / DSO + tiene evidencia de flujo digital + tiene volumen real (no 1–2 personas).
- Si la empresa ya externaliza con un competidor (Evident, Full Contour, Aidite, Automate by 3Shape), márcala como "high" y rellena competitor_match.
- Tener diseñadores propios NO descarta — es señal de que entienden el valor.
- Tamaño de empresa: estima en empleados. Si la evidencia da un rango, usa el punto medio. Si no hay tamaño, deja null (no descartes por eso). Respeta la banda de tamaño pedida: si la evidencia dice que la empresa es mucho más grande que el rango pedido, probablemente no es nuestro target.
- company_linkedin_url: si la evidencia trae la URL corporativa de LinkedIn (formato https://www.linkedin.com/company/<slug>), inclúyela LITERAL. Si no la trae, deja null — NO la inventes ni construyas desde el nombre, pero TAMPOCO descartes la empresa por eso.
- company_country: usa el código ISO de 2 letras cuando puedas inferirlo de la evidencia (US, CA, MX, GB, etc.). Si no puedes inferirlo, deja null (no descartes por eso).
- company_website: si lo incluyes, debe estar literal en la evidencia. Si dudas, déjalo en null antes que inventar.

Reglas de scoring (fit_score):
- "high": labs con software exocad o inLab confirmado, O empresas que ya externalizan con un competidor (Evident, Full Contour, Aidite, Automate). Esto es el sweet spot de weCAD4you.
- "medium": labs con 3Shape o Dental Wings, O labs con señales digitales fuertes pero sin software CAD confirmado, O labs exocad/inLab sin evidencia adicional. 3Shape NO sube a "high" salvo que tenga TRES o más señales adicionales fuertes (competidor en uso, contratación CAD activa, escáner premium, casos digitales publicados).
- "low": evidencia digital débil, posible flujo analógico, o tamaño fuera de banda.

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
  const overshoot = Math.max(1, opts.overshoot ?? 3);
  const verifyLinkedinLive = opts.verify_linkedin_live ?? true;
  const strictRegion = opts.strict_region ?? true;
  const salvageLinkedin = opts.salvage_linkedin ?? true;
  const ask = Math.min(limit * overshoot, 30);

  // 1) Perplexity research
  const regionLabel = REGION_LABEL[region] ?? region;
  const sizeHint = renderSizeHint(size_min, size_max, size_note);
  const competitors = icp.competitors.map((c) => c.name).join(", ");
  const excludeBlock = exclude.length
    ? `\n\nNO incluyas estas empresas (ya están en la base):\n${exclude.map((n) => `- ${n}`).join("\n")}`
    : "";

  const perplexityUser = `Busca ${ask} laboratorios dentales, clínicas multi-centro o DSOs basados en ${regionLabel} que muestren señales de flujos digitales CAD/CAM dental. Perfil deseado: ${sizeHint}.

QUÉ BUSCAR (solo esto):
- Laboratorios dentales que operan como tales (diseñan/fabrican restauraciones).
- Grupos de clínicas dentales multi-centro.
- DSOs (Dental Service Organizations).

QUÉ NO INCLUIR (importante, ensucia los resultados):
- Distribuidores o mayoristas de insumos/equipos dentales.
- Fabricantes de equipos, materiales o software dental (ej. fabricantes de escáneres, de fresadoras, de resinas).
- Proveedores, consultoras, agencias de marketing dental.
- Centros de fresado que solo venden o alquilan equipos sin operar como laboratorio.
- Empresas de OTRAS industrias aunque tengan "lab" en el nombre (biotecnología, agro, farmacéutica, investigación científica, etc.).
- Empresas muy por fuera de la banda de tamaño pedida (${sizeHint}).

PRIORIDAD DE SOFTWARE CAD (clave para weCAD4you):
- Alta prioridad: labs que usan **exocad** o **inLab** (Dentsply Sirona). Son nuestro sweet spot.
- Prioridad media: labs que usan **3Shape** o **Dental Wings**. Válidos pero secundarios — incluye solo si también tienen otras señales fuertes (escáneres premium, contrataciones, externalización ya con competidor, etc.).
- Si tienes que elegir entre devolver más empresas 3Shape o menos pero con exocad/inLab, prefiere exocad/inLab.

Para cada empresa, devuelve los datos que encuentres en fuentes públicas. No descartes laboratorios válidos si te falta algún dato — el sistema posterior filtra. Pero NO incluyas empresas que claramente no son labs/clínicas/DSOs.

Datos que necesito por empresa:
- Nombre exacto de la empresa (obligatorio)
- Ubicación: ciudad y estado/región
- URL de LinkedIn corporativo en formato https://www.linkedin.com/company/<slug>, SOLO si aparece literal en la fuente. NO la construyas a partir del nombre, NO la inventes. Si no la encuentras, déjala en blanco e inclúyela igual.
- Sitio web oficial si está disponible
- Tamaño aproximado en empleados si la fuente lo trae
- Software CAD que mencionan (especifica exocad / inLab / 3Shape / Dental Wings)
- Escáner intraoral que usan (iTero, Medit, Carestream, Cerec)
- Si externalizan diseño CAD con alguno de estos competidores: ${competitors}
- Señales activas: contratando técnico CAD, publican casos digitales, expansión

Estrategia de búsqueda (sigue este orden):
1. Busca específicamente "exocad dental lab ${regionLabel}", "inLab dental lab ${regionLabel}", "exocad case studies", listados de partners de exocad/inLab. Esos son el target principal.
2. Mira directorios públicos de labs dentales (NADL, DentalLabNetwork, etc.) y filtra por mención de exocad o inLab.
3. Después, si necesitas completar el conteo, agrega labs con 3Shape o Dental Wings que tengan otras señales fuertes.
4. Diversifica entre varios estados/regiones para no concentrar todo en un solo lugar.

Cita la fuente de cada empresa con [N].${excludeBlock}`;

  const research = await perplexitySearch({
    system:
      "Eres un asistente de research B2B. Busca evidencia pública verificable sobre laboratorios dentales y clínicas. Cita fuentes.",
    user: perplexityUser
  });

  // 2) Claude structured extraction
  // Cache the ICP rendering (stable across requests) so subsequent runs are cheap.
  const icpRendered = renderIcpPrompt(icp);

  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 16384,
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

  // Filtro de fit: descarta tipos fuera de target (distribuidores, fabricantes,
  // no-dentales que Claude marcó "other") y tamaños groseramente fuera de banda.
  // Esto evita que basura llegue a la cola de revisión humana.
  const fitOnly = dedupOnly.filter((c) => passesFit(c, size_min, size_max));

  // Salvataje de LinkedIn URL: el mayor asesino de yield es que Claude deja
  // company_linkedin_url en null porque Perplexity no la trajo literal. Para
  // las empresas buen-fit sin URL válida, hacemos una segunda búsqueda
  // dedicada que solo resuelve URLs.
  let salvagedCount = 0;
  let withUrl = fitOnly;
  if (salvageLinkedin) {
    const missing = fitOnly.filter((c) => !isValidLinkedinCompanyUrl(c.company_linkedin_url));
    if (missing.length > 0) {
      const resolved = await salvageLinkedinUrls(
        missing.map((c) => c.company_name),
        regionLabel
      );
      withUrl = fitOnly.map((c) => {
        if (isValidLinkedinCompanyUrl(c.company_linkedin_url)) return c;
        const url = resolved.get(c.company_name.toLowerCase().trim());
        if (url && isValidLinkedinCompanyUrl(url)) {
          salvagedCount++;
          return { ...c, company_linkedin_url: url };
        }
        return c;
      });
    }
  }

  const regexOnly = withUrl.filter((c) => isValidLinkedinCompanyUrl(c.company_linkedin_url));
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
    claude_model_used: model_used,
    claude_response_chars: text.length,
    claude_response_preview: text.slice(0, 800),
    claude_extracted: companies.length,
    passed_name: namedOnly.length,
    passed_dedup: dedupOnly.length,
    passed_fit: fitOnly.length,
    salvaged_linkedin: salvagedCount,
    passed_linkedin_regex: regexOnly.length,
    passed_region: regionOnly.length,
    passed_linkedin_live: liveOnly.length,
    final: final.length,
    verify_linkedin_live: verifyLinkedinLive,
    strict_region: strictRegion
  };

  return { companies: final, diagnostics };
}

// Filtro de fit aplicado en código (no en el prompt — el prompt ya pide a
// Claude que no extraiga basura, pero esto es la red de seguridad).
function passesFit(
  c: DiscoveredCompany,
  sizeMin: number,
  sizeMax: number | null
): boolean {
  // Tipo fuera de target: distribuidores, fabricantes, no-dentales. Claude
  // los debería omitir, pero si igual marca "other", acá los cortamos.
  if (c.company_type === "other") return false;
  // Tamaño groseramente fuera de banda — solo cuando el tamaño es conocido
  // (los null pasan, Claude muchas veces no tiene el dato). Tolerancia
  // generosa (3x el techo) para no perder borderline: un techo de 50 deja
  // pasar hasta 150, pero descarta el distribuidor de 350.
  if (c.company_size != null) {
    if (sizeMax != null && c.company_size > sizeMax * 3) return false;
    const floor = Math.max(1, Math.floor(sizeMin / 3));
    if (c.company_size < floor) return false;
  }
  return true;
}

// Segunda llamada a Perplexity dedicada a resolver LinkedIn URLs de empresas
// que pasaron el filtro de fit pero quedaron sin URL. Best-effort: lo que no
// resuelva queda en null y se filtra después. Matchea por nombre exacto
// (lowercase) — Perplexity debería echar el nombre tal cual se lo pasamos.
async function salvageLinkedinUrls(
  names: string[],
  regionLabel: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (names.length === 0) return out;
  const list = names.map((n) => `- ${n}`).join("\n");

  let research;
  try {
    research = await perplexitySearch({
      system:
        "Eres un asistente de research B2B. Devolvés URLs de LinkedIn corporativo verificadas en fuentes públicas. NUNCA inventás URLs.",
      user: `Para cada una de estas empresas de ${regionLabel}, encontrá su URL de LinkedIn corporativo oficial en formato https://www.linkedin.com/company/<slug>.

Empresas:
${list}

Reglas:
- Incluí la URL SOLO si la encontrás en fuentes públicas verificables. Si no la encontrás, dejá linkedin_url en null. NUNCA la inventes ni la construyas desde el nombre.
- Devolvé SOLO JSON válido, sin texto alrededor, con esta forma:
{ "results": [ { "name": "<nombre exacto tal como te lo pasé>", "linkedin_url": "https://www.linkedin.com/company/..." | null } ] }`
    });
  } catch {
    return out;
  }

  const parsed = extractJson(research.content);
  if (!parsed || !Array.isArray(parsed.results)) return out;
  for (const r of parsed.results) {
    const name = String(r?.name ?? "").toLowerCase().trim();
    const url = r?.linkedin_url;
    if (name && typeof url === "string" && isValidLinkedinCompanyUrl(url)) {
      out.set(name, url.trim());
    }
  }
  return out;
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

