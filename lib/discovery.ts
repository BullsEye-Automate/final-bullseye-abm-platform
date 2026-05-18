import type Anthropic from "@anthropic-ai/sdk";
import { createMessageWithFallback } from "./claude";
import { perplexitySearch, PerplexityCitation } from "./perplexity";
import type { IcpConfig } from "./supabase";
import {
  evidenceQuality,
  validateCompanyEvidence,
  type EvidenceQuality
} from "./companyEvidence";

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
  // Calidad de evidencia post-validación. "specific" = al menos una cita
  // nombra a la empresa; "generic" = solo contexto del rubro, datos
  // operativos nuleados por validación; "none" = sin citas.
  evidence_quality: EvidenceQuality;
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
  // Cuando es true (default), solo dejan pasar empresas con evidencia
  // específica (cita que nombra a la empresa). Cuando es false, también
  // dejan pasar las que tienen citas pero NINGUNA las nombra ("generic")
  // — útil cuando el régimen estricto descarta todo y necesitamos yield.
  // Las que no tienen NINGUNA cita ("none") siguen fuera.
  require_specific_evidence?: boolean;
};

export type DiscoveryDiagnostics = {
  perplexity_asked: number;
  perplexity_content_chars: number;
  perplexity_content_preview: string;
  claude_model_used: string;
  claude_response_chars: number;
  claude_response_preview: string;
  claude_extracted: number;
  // Calidad de evidencia (post-validación de fuentes):
  evidence_specific: number; // citas que nombran la empresa
  evidence_generic_dropped: number; // solo contexto rubro, descartadas
  evidence_none_dropped: number; // sin citas, descartadas
  passed_name: number;
  passed_dedup: number;
  passed_evidence: number;
  passed_honest: number; // sin contradicción en research_summary
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

PRINCIPIO RECTOR (no negociable):
PREFIERO HONESTIDAD SOBRE COMPLETITUD. Una tarjeta que dice "no hay información pública digital sobre esta empresa" es 1000 veces mejor que una tarjeta con datos inventados. Si vas a hacer outreach con datos falsos, la prospección se vuelve MUY MALA. Bajo NINGUNA circunstancia rellenes campos con información de contexto general del rubro y la atribuyas a una empresa específica.

REGLA DE EVIDENCIA POR EMPRESA (la regla más importante):
Cada hecho que escribas sobre una empresa específica DEBE estar respaldado por una cita [N] que LITERALMENTE nombre a esa empresa. Las citas genéricas del rubro (PDFs académicos sobre CAD/CAM dental, artículos sobre tendencias del sector, guías universitarias, listados de directorios generales) NO sirven como respaldo de hechos operativos de una empresa específica. Sirven solo para confirmar que el rubro existe — nada más.

Si la evidencia provista NO trae una cita que nombre a la empresa Y describa el hecho:
  → cad_software, scanner_technology, competitor_match → null
  → fit_signals → no incluir esa señal
  → fit_score → no puede ser "high"

Reglas de extracción:
- Trabajas ÚNICAMENTE con la evidencia provista. Si la evidencia no menciona algo de UNA empresa específica, déjalo en null. NO inventes, NO infieras, NO extrapoles del contexto del rubro.
- Extrae empresas que la evidencia mencione como laboratorio dental, clínica multi-centro o DSO, aunque falten campos. Una empresa puede entrar con datos casi todos en null si la evidencia confirma que existe y es del rubro pero no aporta detalles operativos. Eso es preferible a llenar campos a mojón.
- **NO extraigas** (estos NO son nuestro target y ensucian la cola de revisión):
  - Distribuidores de insumos o equipos dentales.
  - Fabricantes de equipos, materiales o software dental.
  - Proveedores, mayoristas, consultoras, agencias.
  - Centros de fresado que solo venden equipos sin operar como laboratorio.
  - Empresas de OTRAS industrias (biotecnología, agro, farma, etc.) — aunque el nombre tenga la palabra "lab".
  - **Clínicas dentales PRIVADAS de UNA SOLA sede** (1 ubicación, dueño dentista, sin más sucursales). Eso NO es ni "lab" ni "multi_clinic" — es UNA clínica privada. **Una clínica con 2+ sucursales SÍ entra como multi_clinic.**
  - Páginas LinkedIn "por reclamar" o fantasmas (pocos seguidores, 0 empleados listados, página corporativa que claramente nadie mantiene).
  Si una empresa NO es claramente un laboratorio dental, una clínica dental multi-centro (2+ ubicaciones operadas por el mismo dueño/management) o un DSO que opera como tal, NO la incluyas en absoluto. No uses "other" como cajón de sastre, y NO inventes que una single practice es "multi_clinic".

REGLA CRÍTICA DE company_type:
- "lab" → laboratorio dental con producción de prótesis (propio, no terciariza todo). Operación de laboratorio = lab.
- "multi_clinic" → grupo de **2 o más clínicas** dentales operadas centralizadamente bajo un mismo dueño/management. Una sola clínica = NO entra. Idealmente con flujo digital confirmado (escáner intraoral, exocad / 3Shape / inLab, impresión 3D, casos digitales o externalización), pero no es requisito duro — la revisión humana valida después.
- "dso" → Dental Service Organization (corporativo, multi-clínica con management profesional, generalmente backed por private equity).
- "other" → CUALQUIER otra cosa (single practice, distribuidor, fabricante, etc.). Si marcas "other" la empresa se descarta automáticamente. Sé honesto.

Campos operativos (cad_software, scanner_technology, competitor_match):
- SOLO se incluyen si una cita [N] específica menciona a ESTA empresa Y describe ese hecho.
- Prohibido inferir de: contexto general del rubro, patrones de la región, "típico de labs de este tamaño", "probablemente usan X".
- Si la evidencia dice "muchos labs en EE.UU. usan exocad" → eso NO te autoriza a poner cad_software="exocad" en ninguna empresa específica.
- Si la evidencia solo lista a la empresa (Manta, Yelp, BBB, directorios) sin detalles tecnológicos → todos los campos operativos van en null.

Tamaño de empresa (company_size, en número de empleados):
- FUENTE AUTORITATIVA: el contador "X employees" / "X empleados" de la página corporativa de LinkedIn (https://www.linkedin.com/company/...). Es lo único realmente actualizado.
- Aceptable también: una página oficial reciente de la empresa que diga literalmente el número (About Us, Team, Careers, comunicado de prensa con fecha del último año).
- NO ACEPTABLE como dato de tamaño (suelen estar desactualizados 5-10 años o son estimaciones inventadas): Manta, BBB, Yelp, ZoomInfo, Hoovers, Crunchbase rangos viejos, "rangos típicos del rubro", "probablemente N empleados", directorios genéricos sin fecha visible.
- Si la única fuente disponible es uno de esos directorios desactualizados → company_size=null. NO copies el número que dice ahí.
- MEJOR NULL QUE UN NÚMERO FALSO. El usuario corrige a mano si hace falta — un número inventado rompe la personalización del outreach (un lab que tiene 90 empleados pero ponemos 20 recibe un mensaje pensado para un lab chico).
- Si la evidencia te da un rango ("11-50 employees", "50-100"), usá el punto medio SOLO si la fuente es LinkedIn. Si es Manta/BBB, null.
- Si no hay dato confiable → null. Respeta la banda pedida solo para descartar groseros (micro-labs 1-10 cuando piden 30+).

URLs y ubicación:
- company_linkedin_url: si la evidencia trae la URL corporativa de LinkedIn (formato https://www.linkedin.com/company/<slug>), inclúyela LITERAL. Si no la trae, deja null — NUNCA la inventes ni construyas desde el nombre.
- company_website: literal de la evidencia. Si dudas, null.
- company_country: código ISO 2 letras si la evidencia lo confirma. Si no, null.

fit_signals (formato exacto y obligatorio):
- Lista corta separada por " · ".
- CADA señal operativa (software, escáner, externalización con competidor, contratación activa, casos digitales, expansión, tutoriales propios, partnerships) DEBE terminar con [N] indicando la cita exacta que la respalda con mención literal de la empresa.
- Las señales descriptivas (tipo de empresa, ubicación, tamaño aproximado) NO requieren [N].
- Si una empresa no tiene NINGUNA señal operativa con cita específica, fit_signals puede ser corto (solo descriptivo) o vacío. Vacío es ACEPTABLE. Inventar es INACEPTABLE.
- Ejemplos válidos:
  - "Laboratorio dental local · 3Shape inLab confirmado en página de servicios [2] · contratando CAD designer (job posting Indeed) [4]" ← señales operativas tienen [N].
  - "Laboratorio dental en Salt Lake City · Sin evidencia pública de software CAD ni escáner" ← honesto, sin señales operativas inventadas.
  - "" ← vacío, mejor que inventar.

Reglas de scoring (fit_score) — escala calibrada por niveles de evidencia:

- "low" (default para empresas del rubro):
  - La empresa es claramente un laboratorio dental, multi-clínica (2+ sedes) o DSO.
  - Asumimos flujo digital base (todos los labs/multi-clinics modernos lo tienen).
  - NO requiere cita específica de software/escáner — alcanza con que esté establecida como lab/multi_clinic/DSO con web propia o LinkedIn corporativo válido.

- "medium" (low + AL MENOS UNA señal operativa adicional, todas con cita [N] que nombre la empresa):
  - Contratación activa de CAD designer / 3D designer / dental technician CAD (job posting con cita).
  - Web propia menciona aceptar trabajos / archivos STL de múltiples escáneres intraorales (multi-scanner support).
  - Uso de exocad confirmado [N].
  - Uso de Dentsply Sirona stack (DS Core, Primescan, CEREC, inLab) confirmado [N].
  - Otra tecnología CAD/CAM confirmada por cita: 3Shape, Dental Wings, Formlabs, NextDent, 3D Systems, etc.
  - Tutoriales / contenido educativo propio sobre workflow digital con cita.

- "high" (medium + externalización de diseño CAD confirmada):
  - La empresa ya externaliza diseños CAD a un freelance, empresa especializada en diseño, o competidor nuestro (Evident, Full Contour, Aidite, Automate by 3Shape, NDX, Drake Labs, etc.) — confirmado con cita [N] que nombre la empresa Y mencione la externalización.

Reglas de honestidad:
- Sin AT LEAST UNA cita específica de algo operativo concreto → fit_score = "low" (no upgrade a medium/high).
- Si el upgrade a medium/high se basa en inferencia ("seguramente usan X") en vez de cita literal → fit_score = "low".
- NO inventes señales. Si no hay evidencia, dejá fit_signals corto y fit_score="low".

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
research_summary: 2–3 frases honestas. Si hay evidencia específica, decí qué dice. Si NO hay evidencia específica, decilo así: "Listada como [tipo] en [fuente genérica]. No hay información pública sobre software CAD, escáner u operación digital. Fit incierto sin verificación directa." NO inventes una narrativa optimista para llenar el campo.`;

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
  const requireSpecific = opts.require_specific_evidence ?? true;
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
- Micro-laboratorios de 1-10 empleados (badge "2-10 employees" / "1-10 employees" en LinkedIn) cuando el rango pedido es mayor: no tienen volumen, su página de LinkedIn suele estar vacía y la búsqueda de contactos posterior rinde cero.
- Empresas muy por fuera de la banda de tamaño pedida (${sizeHint}), por arriba o por abajo.

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

REGLAS DE EVIDENCIA (críticas):
- Para CADA empresa que devuelvas, las citas deben nombrar específicamente a esa empresa (su sitio web, su perfil de LinkedIn, su listado en directorio, una nota de prensa que la mencione, un job posting suyo, un caso publicado por ella). Las citas genéricas del rubro (PDFs académicos, guías universitarias, artículos de tendencias) NO sirven como respaldo de hechos operativos.
- Si solo encontrás contexto general del rubro sin fuentes que nombren a la empresa, INCLUILA igual (puede ser real) pero NO inventes software, escáner ni señales operativas — el sistema posterior validará y bajará el score.
- Para CADA hecho operativo que reportes sobre una empresa (software CAD, escáner, externalización con competidor, contratación activa, expansión, casos digitales), citá la fuente específica que lo respalda con [N]. Si no tenés cita específica, NO reportes el hecho — reportá "sin información pública" honestamente.

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
  const rawCompanies: DiscoveredCompany[] = Array.isArray(parsed?.companies)
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
        research_sources: research.citations,
        evidence_quality: evidenceQuality(String(c.company_name ?? "").trim(), research.citations)
      }))
    : [];

  // VALIDACIÓN DE EVIDENCIA — paso crítico.
  // Para cada empresa, strippea señales operativas que no tengan cita [N]
  // específica que nombre a la empresa, y degrada fit_score si la empresa
  // no tiene NINGUNA cita específica. Esto previene el caso Elite Dental
  // Lab (todas las señales operativas inventadas a partir de PDFs genéricos
  // del rubro).
  const companies: DiscoveredCompany[] = rawCompanies.map((c) => {
    const { company, outcome } = validateCompanyEvidence(c);
    return { ...company, evidence_quality: outcome.evidence_quality };
  });

  let evidenceSpecific = 0;
  let evidenceGenericDropped = 0;
  let evidenceNoneDropped = 0;
  for (const c of companies) {
    if (c.evidence_quality === "specific") evidenceSpecific++;
    else if (c.evidence_quality === "generic") evidenceGenericDropped++;
    else evidenceNoneDropped++;
  }

  // Pipeline de filtros — registrar cuántas empresas sobreviven a cada paso
  // para mostrar el funnel en la UI.
  const excludeSet = new Set(exclude.map((n) => n.toLowerCase().trim()));

  const namedOnly = companies.filter((c) => c.company_name.length > 0);
  const dedupOnly = namedOnly.filter((c) => !excludeSet.has(c.company_name.toLowerCase().trim()));

  // Filtro de evidencia. Modo estricto (default): solo "specific" pasa —
  // se rechaza todo lo que no tenga cita que nombre a la empresa. Reemplaza
  // el problema Elite Dental Lab (datos inventados). Modo permisivo
  // (require_specific_evidence=false): también dejan pasar "generic"
  // (tiene citas, pero ninguna la nombra directamente). En ambos modos las
  // que no tienen NINGUNA cita ("none") quedan fuera.
  const evidenceOnly = requireSpecific
    ? dedupOnly.filter((c) => c.evidence_quality === "specific")
    : dedupOnly.filter((c) => c.evidence_quality !== "none");

  // Filtro de "honestidad": si Claude clasificó la empresa como lab/multi_clinic/dso
  // PERO su propio research_summary dice "no es un laboratorio", "clínica privada",
  // "queda fuera del ICP", etc., la rechazamos. Es señal de que Claude está
  // siendo deshonesto con company_type para incluir la empresa, contradiciendo
  // su propia evidencia. Aplica en ambos modos (estricto y permisivo).
  const honestOnly = evidenceOnly.filter((c) => !summaryFlagsOutOfIcp(c.research_summary));
  // Filtro de fit: descarta tipos fuera de target (distribuidores, fabricantes,
  // no-dentales que Claude marcó "other") y tamaños groseramente fuera de banda.
  // Esto evita que basura llegue a la cola de revisión humana.
  const fitOnly = honestOnly.filter((c) => passesFit(c, size_min, size_max));

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

  // Priorización: dentro de las que pasaron todos los filtros, ordenamos
  // por (fit_score desc, riqueza de fit_signals desc). Más señales
  // operativas confirmadas = más material para personalizar el outreach.
  // El usuario explícitamente pidió priorizar las que tienen info útil
  // para personalización.
  const scoreRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const signalDepth = (s: string): number =>
    s
      .split("·")
      .map((p) => p.trim())
      .filter((p) => p.length > 0).length;

  const ranked = [...liveOnly].sort((a, b) => {
    const aScore = scoreRank[a.fit_score] ?? 0;
    const bScore = scoreRank[b.fit_score] ?? 0;
    if (aScore !== bScore) return bScore - aScore;
    return signalDepth(b.fit_signals) - signalDepth(a.fit_signals);
  });

  // Cortamos a `limit` tras priorizar (el overshoot solo era buffer).
  let final = ranked.slice(0, limit);

  // Pase dedicado: confirmar/sacar el employee count desde LinkedIn para
  // todas las empresas que tienen LinkedIn URL válido. Sobreescribe el
  // company_size con el dato del LinkedIn cuando lo encuentra. Si no lo
  // encuentra, deja lo que ya había (que puede ser null).
  if (final.length > 0) {
    const items = final
      .filter((c) => c.company_linkedin_url)
      .map((c) => ({ name: c.company_name, linkedin_url: c.company_linkedin_url! }));
    if (items.length > 0) {
      const sizes = await salvageEmployeeCounts(items);
      final = final.map((c) => {
        const fromLinkedin = sizes.get(c.company_name.toLowerCase().trim());
        if (typeof fromLinkedin === "number") {
          return { ...c, company_size: fromLinkedin };
        }
        return c;
      });
    }
  }

  const diagnostics: DiscoveryDiagnostics = {
    perplexity_asked: ask,
    perplexity_content_chars: research.content.length,
    perplexity_content_preview: research.content.slice(0, 600),
    claude_model_used: model_used,
    claude_response_chars: text.length,
    claude_response_preview: text.slice(0, 800),
    claude_extracted: companies.length,
    evidence_specific: evidenceSpecific,
    evidence_generic_dropped: evidenceGenericDropped,
    evidence_none_dropped: evidenceNoneDropped,
    passed_name: namedOnly.length,
    passed_dedup: dedupOnly.length,
    passed_evidence: evidenceOnly.length,
    passed_honest: honestOnly.length,
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
// Detecta cuando el propio research_summary de Claude desmiente el
// company_type asignado. Patrones que vimos en producción: clínicas
// privadas que Claude marcó como "lab" para no descartarlas.
// Apply MUY laxo — solo capturamos contradicciones explícitas.
function summaryFlagsOutOfIcp(summary: string | null | undefined): boolean {
  if (!summary) return false;
  const t = summary.toLowerCase();
  // "No es un laboratorio" / "no es una DSO" / "no es lab" / "no es multi-sede".
  if (
    /\bno es un(?:a)?\s+(laboratorio|dso|grupo|multi)/i.test(t) ||
    /\bno constituye\s+(?:un|una)/i.test(t) ||
    /\bno califica\s+(?:como|para)/i.test(t)
  ) {
    return true;
  }
  // "Queda fuera del ICP" / "fuera del ICP" / "out of scope".
  if (/\b(queda\s+)?fuera del icp\b/.test(t) || /\bout of (?:scope|icp)\b/.test(t)) {
    return true;
  }
  // "Clínica dental privada" / "single dental practice" / "private dental practice"
  // — son single-practice, no multi_clinic. Si Claude lo dijo, hay que respetar.
  // PERO: una clínica privada con 2+ sucursales SÍ es multi_clinic y entra.
  if (
    /\bcl[íi]nica\s+(?:dental\s+)?privada\b/.test(t) ||
    /\bconsulta\s+(?:dental\s+)?privada\b/.test(t) ||
    /\bsingle\s+(?:dental\s+)?(?:practice|office|clinic)\b/.test(t) ||
    /\bprivate\s+(?:dental\s+)?practice\b/.test(t)
  ) {
    // Excepciones: si menciona ser parte de grupo / multi-sede / cadena.
    const isMulti =
      /(grupo|chain|dso|multi-?(clinic|sede|location)|sucursal(es)?|sedes)/i.test(t) ||
      // Numérico explícito: "2 clínicas", "two locations", "tres centros".
      /\b([2-9]|10|dos|tres|cuatro|cinco|two|three|four|five)\s+(cl[íi]nica|cl[íi]nicas|centros?|sucursales?|sedes?|locations?|offices?|practices?|consultas?)\b/i.test(
        t
      );
    if (!isMulti) return true;
  }
  return false;
}

function passesFit(
  c: DiscoveredCompany,
  sizeMin: number,
  sizeMax: number | null
): boolean {
  // Tipo fuera de target: distribuidores, fabricantes, no-dentales. Claude
  // los debería omitir, pero si igual marca "other", acá los cortamos.
  if (c.company_type === "other") return false;
  // Tamaño fuera de banda — solo cuando el tamaño es conocido (los null
  // pasan, Claude muchas veces no tiene el dato).
  if (c.company_size != null) {
    // Techo generoso (3x) para no perder borderline grande.
    if (sizeMax != null && c.company_size > sizeMax * 3) return false;
    // Piso a 70% del mínimo pedido: un micro-lab "2-10 employees" (≈6) se
    // descarta cuando se pide 15+, pero un borderline real (12-14 para un
    // mínimo de 15) sigue pasando para revisión humana. Los micro-labs no
    // tienen volumen ni buyer personas, y su LinkedIn suele estar vacío
    // (Clay no encuentra contactos).
    const floor = Math.max(1, Math.floor(sizeMin * 0.7));
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

// Pase dedicado a confirmar/sacar el employee count desde LinkedIn.
// Disparador: Perplexity en la corrida principal acepta números de Manta/
// BBB que están desactualizados (caso real: lab con 90 empleados en
// LinkedIn, Perplexity reportó 20 de Manta y el icebreaker salió
// personalizado para un lab chico). Este pase es dedicado y específico:
// le pide a Perplexity que mire el "X employees" badge de la página de
// LinkedIn. Si no puede verificarlo (login wall, página privada), devuelve
// null y respetamos el valor original.
//
// Devuelve un Map<nombreLowerCase, number>. Solo incluye matches positivos.
export async function salvageEmployeeCounts(
  items: Array<{ name: string; linkedin_url: string }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;

  const list = items
    .map((i) => `- ${i.name} (LinkedIn: ${i.linkedin_url})`)
    .join("\n");

  let research;
  try {
    research = await perplexitySearch({
      system:
        "Sos un asistente que extrae employee count de páginas de LinkedIn corporativo. Devolvés solo números verificados del badge 'X employees' de LinkedIn. NUNCA inventás números ni copiás de Manta/BBB/Yelp/ZoomInfo/Hoovers (esos están desactualizados).",
      user: `Para cada empresa de la lista, decime cuántos empleados tiene SEGÚN LA PÁGINA DE LINKEDIN CORPORATIVO (el badge "X employees" o "X empleados" que aparece al lado del nombre de la empresa o en la sección "Company info"). Si la página de LinkedIn no se puede leer, está privada, requiere login, o el badge no es visible, devolvé null para esa empresa. NO uses Manta, BBB, Yelp, ZoomInfo, Hoovers ni directorios desactualizados — solo LinkedIn.

Empresas:
${list}

Regla crucial: si NO podés verificar el número en LinkedIn, devolvé null. Es 1000 veces mejor null que un número falso.

Devolvé SOLO JSON válido, sin texto alrededor:
{ "results": [ { "name": "<nombre exacto como te lo pasé>", "employees_on_linkedin": number | null } ] }`
    });
  } catch {
    return out;
  }

  const parsed = extractJson(research.content);
  if (!parsed || !Array.isArray(parsed.results)) return out;
  for (const r of parsed.results) {
    const name = String(r?.name ?? "").toLowerCase().trim();
    const raw = r?.employees_on_linkedin;
    if (!name) continue;
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
        ? parseInt(raw.replace(/[^0-9]/g, ""), 10)
        : NaN;
    if (Number.isFinite(n) && n >= 1) {
      out.set(name, n);
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

