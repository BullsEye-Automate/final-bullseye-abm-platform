// Filtros unificados de la wishlist del portal (compartido navegador/servidor).
//
// El cliente ve UN solo set de filtros en español. Por detrás cada filtro se
// traduce a la base de HubSpot de BullsEye y a la base de Lemlist (ver
// lib/unifiedSearch.ts). El cliente nunca ve de qué base viene cada empresa.

export type UnifiedFilterKey =
  | "keyword"
  | "description"
  | "industries"
  | "companyTypes"
  | "markets"
  | "countries"
  | "regions"
  | "cities"
  | "sizes"
  | "revenues"
  | "funding"
  | "technologies"
  | "recentTechnologies"
  | "renewalTechnologies"
  | "jobTitles"
  | "jobKeywords"
  | "jobDate";

// Valores elegidos por el cliente. keyword/description son texto; el resto listas.
export type UnifiedFilters = Partial<Record<UnifiedFilterKey, string | string[]>>;

export type FilterControl = "text" | "longtext" | "select" | "tags";

export type UnifiedFilterDef = {
  key: UnifiedFilterKey;
  label: string;
  hint?: string;
  control: FilterControl;
  lemlistFilterId: string | null;    // null = no existe en Lemlist
  hubspot: boolean;                  // se puede aplicar a la base HubSpot
};

export const FILTER_GROUPS: { title: string; filters: UnifiedFilterDef[] }[] = [
  {
    title: "Información de la empresa",
    filters: [
      { key: "keyword", label: "Palabra clave", hint: "En el nombre o la descripción (ej: logística, fintech)", control: "text", lemlistFilterId: "keywordInCompany", hubspot: true },
      { key: "description", label: "Describe la empresa ideal", hint: "Ej: empresas de software B2B para equipos de finanzas", control: "longtext", lemlistFilterId: "semanticSearch", hubspot: false },
      { key: "industries", label: "Industria", control: "select", lemlistFilterId: "currentCompanySubIndustry", hubspot: true },
      { key: "companyTypes", label: "Tipo de empresa", control: "select", lemlistFilterId: "currentCompanyType", hubspot: false },
      { key: "markets", label: "Mercado", control: "select", lemlistFilterId: "currentCompanyMarket", hubspot: false },
    ],
  },
  {
    title: "Ubicación",
    filters: [
      { key: "countries", label: "País", control: "select", lemlistFilterId: "currentCompanyCountry", hubspot: true },
      { key: "regions", label: "Región", control: "select", lemlistFilterId: "currentCompanyRegion", hubspot: false },
      { key: "cities", label: "Ciudad / estado", hint: "Escribe y presiona Enter", control: "tags", lemlistFilterId: "currentCompanyLocation", hubspot: true },
    ],
  },
  {
    title: "Tamaño y finanzas",
    filters: [
      { key: "sizes", label: "Número de empleados", control: "select", lemlistFilterId: "currentCompanyHeadcount", hubspot: true },
      { key: "revenues", label: "Facturación anual (USD)", control: "select", lemlistFilterId: "currentCompanyRevenue", hubspot: true },
      { key: "funding", label: "Última ronda de inversión", control: "select", lemlistFilterId: "currentCompanyLastFundingRoundAt", hubspot: false },
    ],
  },
  {
    title: "Tecnologías",
    filters: [
      { key: "technologies", label: "Usa estas tecnologías", hint: "Ej: Salesforce, SAP, HubSpot", control: "tags", lemlistFilterId: "currentCompanyTechnologies", hubspot: true },
      { key: "recentTechnologies", label: "Adoptadas en los últimos 6 meses", control: "tags", lemlistFilterId: "recentlyDetectedTechnologies", hubspot: false },
      { key: "renewalTechnologies", label: "Renovación en los próximos 6 meses", hint: "Aniversario de contrato probable", control: "tags", lemlistFilterId: "upcomingAnniversaryTechnologies", hubspot: false },
    ],
  },
  {
    title: "Ofertas de empleo",
    filters: [
      { key: "jobTitles", label: "Cargo que están contratando", hint: "Ej: Gerente comercial, SDR", control: "tags", lemlistFilterId: "jobPostingTitle", hubspot: false },
      { key: "jobKeywords", label: "Palabra clave en las ofertas", control: "tags", lemlistFilterId: "jobPostingKeyword", hubspot: false },
      { key: "jobDate", label: "Publicada hace", control: "select", lemlistFilterId: "jobPostingDate", hubspot: false },
    ],
  },
];

export const ALL_FILTERS: UnifiedFilterDef[] = FILTER_GROUPS.flatMap((g) => g.filters);

export function filterValues(f: UnifiedFilters, key: UnifiedFilterKey): string[] {
  const v = f[key];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

export function hasAnyFilter(f: UnifiedFilters): boolean {
  return ALL_FILTERS.some((d) => filterValues(f, d.key).length > 0);
}

// ── Países ───────────────────────────────────────────────────────────────
// value = nombre en Lemlist (inglés); hubspot = cómo puede venir en "País" (pais_g)
export const COUNTRIES: { value: string; label: string; hubspot: string[] }[] = [
  { value: "Chile", label: "Chile", hubspot: ["Chile"] },
  { value: "Mexico", label: "México", hubspot: ["México", "Mexico"] },
  { value: "Colombia", label: "Colombia", hubspot: ["Colombia"] },
  { value: "Peru", label: "Perú", hubspot: ["Perú", "Peru"] },
  { value: "Argentina", label: "Argentina", hubspot: ["Argentina"] },
  { value: "Brazil", label: "Brasil", hubspot: ["Brasil", "Brazil"] },
  { value: "Ecuador", label: "Ecuador", hubspot: ["Ecuador"] },
  { value: "Uruguay", label: "Uruguay", hubspot: ["Uruguay"] },
  { value: "Paraguay", label: "Paraguay", hubspot: ["Paraguay"] },
  { value: "Bolivia", label: "Bolivia", hubspot: ["Bolivia"] },
  { value: "Venezuela", label: "Venezuela", hubspot: ["Venezuela"] },
  { value: "Panama", label: "Panamá", hubspot: ["Panamá", "Panama"] },
  { value: "Costa Rica", label: "Costa Rica", hubspot: ["Costa Rica"] },
  { value: "Guatemala", label: "Guatemala", hubspot: ["Guatemala"] },
  { value: "Honduras", label: "Honduras", hubspot: ["Honduras"] },
  { value: "El Salvador", label: "El Salvador", hubspot: ["El Salvador"] },
  { value: "Nicaragua", label: "Nicaragua", hubspot: ["Nicaragua"] },
  { value: "Dominican Republic", label: "República Dominicana", hubspot: ["República Dominicana", "Republica Dominicana", "Dominican Republic"] },
  { value: "Puerto Rico", label: "Puerto Rico", hubspot: ["Puerto Rico"] },
  { value: "Spain", label: "España", hubspot: ["España", "Espana", "Spain"] },
  { value: "Portugal", label: "Portugal", hubspot: ["Portugal"] },
  { value: "United States", label: "Estados Unidos", hubspot: ["Estados Unidos", "EEUU", "EE.UU.", "USA", "United States"] },
  { value: "Canada", label: "Canadá", hubspot: ["Canadá", "Canada"] },
  { value: "United Kingdom", label: "Reino Unido", hubspot: ["Reino Unido", "United Kingdom", "UK"] },
  { value: "France", label: "Francia", hubspot: ["Francia", "France"] },
  { value: "Germany", label: "Alemania", hubspot: ["Alemania", "Germany"] },
  { value: "Italy", label: "Italia", hubspot: ["Italia", "Italy"] },
  { value: "Netherlands", label: "Países Bajos", hubspot: ["Países Bajos", "Paises Bajos", "Holanda", "Netherlands"] },
  { value: "Switzerland", label: "Suiza", hubspot: ["Suiza", "Switzerland"] },
  { value: "Israel", label: "Israel", hubspot: ["Israel"] },
  { value: "India", label: "India", hubspot: ["India"] },
  { value: "China", label: "China", hubspot: ["China"] },
  { value: "Japan", label: "Japón", hubspot: ["Japón", "Japon", "Japan"] },
  { value: "Australia", label: "Australia", hubspot: ["Australia"] },
];

// ── Tramos de empleados y facturación ────────────────────────────────────
// Lemlist usa tramos de texto ("11-50", "10001+", "$1M - $3M"). Se convierten
// a rangos numéricos para filtrar la base HubSpot (numberofemployees / annualrevenue).

export function parseHeadcountBucket(v: string): { min: number | null; max: number | null } | null {
  const s = v.replace(/[,.\s]/g, "");
  let m = s.match(/^(\d+)-(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/^(\d+)\+$/);
  if (m) return { min: Number(m[1]), max: null };
  return null;
}

function money(token: string): number | null {
  const m = token.replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Number(m[1]) * mult;
}

export function parseRevenueBucket(v: string): { min: number | null; max: number | null } | null {
  const s = v.trim();
  let m = s.match(/^(?:<|less than|under)\s*(.+)$/i);
  if (m) return money(m[1]) != null ? { min: null, max: money(m[1]) } : null;
  m = s.match(/^(.+?)\s*\+$/) ?? s.match(/^(?:>|more than|over)\s*(.+)$/i);
  if (m) return money(m[1]) != null ? { min: money(m[1]), max: null } : null;
  m = s.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (m) {
    const a = money(m[1]);
    const b = money(m[2]);
    return a != null && b != null ? { min: a, max: b } : null;
  }
  return null;
}

// Une varios tramos en un solo rango (del menor mínimo al mayor máximo)
export function unionRange(ranges: ({ min: number | null; max: number | null } | null)[]) {
  const valid = ranges.filter((r): r is { min: number | null; max: number | null } => !!r);
  if (!valid.length) return null;
  const min = valid.some((r) => r.min == null) ? null : Math.min(...valid.map((r) => r.min as number));
  const max = valid.some((r) => r.max == null) ? null : Math.max(...valid.map((r) => r.max as number));
  return { min, max };
}

export const HEADCOUNT_FALLBACK = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];
export const REVENUE_FALLBACK = ["< $1M", "$1M - $10M", "$10M - $50M", "$50M - $100M", "$100M - $500M", "$500M - $1B", "$1B+"];

export function headcountLabel(v: string): string {
  const r = parseHeadcountBucket(v);
  if (!r) return v;
  const f = (n: number) => n.toLocaleString("es-CL");
  return r.max == null ? `Más de ${f(r.min ?? 0)}` : `${f(r.min ?? 0)} – ${f(r.max)}`;
}
