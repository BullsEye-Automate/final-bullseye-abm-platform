// Calendario de feriados de los países a los que llama BullsEye (Chile,
// México, Colombia, Perú y Argentina), para la Alerta de feriados diaria
// (lib/feriados/, /analisis/feriados). Sin dependencias de Node: se usa en
// el servidor y en el navegador.
//
// Fuente: la ley o el decreto oficial de cada país (no portales de noticias).
// Cada feriado lleva su respaldo legal en `legal`. Tipos:
// - national: feriado nacional (no se llama a ese país).
// - regional: feriado solo en una región/provincia (`regions`); se marca
//   "revisar" porque la planilla de reuniones no trae la región.
// - low: no es feriado obligatorio, pero baja mucho la contactabilidad
//   (Día de Muertos en México, días no laborables turísticos de Argentina,
//   24 y 31 de diciembre).
//
// MANTENCIÓN: `COUNTRIES[x].coveredThrough` es la última fecha cargada y
// verificada por país. Cuando la ventana del correo pasa esa fecha, el correo
// avisa que falta cargar el año siguiente. Si un gobierno decreta un feriado
// nuevo (como el Decreto 1103/2026 de Argentina), se agrega acá. Argentina
// aún no decreta los días no laborables turísticos de 2027.

export type CountryCode = "CL" | "MX" | "CO" | "PE" | "AR";
export type HolidayKind = "national" | "regional" | "low";

export type Holiday = {
  date: string; // YYYY-MM-DD
  country: CountryCode;
  name: string;
  kind: HolidayKind;
  regions?: string; // solo para kind = "regional"
  legal: string; // respaldo legal (ley, decreto)
};

export type CountryInfo = {
  code: CountryCode;
  name: string; // nombre canónico (el de lib/celulasSdr/country.ts)
  timeZone: string;
  source: string; // fuente oficial
  sourceUrl: string;
  coveredThrough: string;
};

export const COUNTRIES: Record<CountryCode, CountryInfo> = {
  CL: {
    code: "CL",
    name: "Chile",
    timeZone: "America/Santiago",
    source: "Leyes de feriados (Biblioteca del Congreso Nacional)",
    sourceUrl: "https://www.bcn.cl/leyfacil/recurso/feriados",
    coveredThrough: "2027-03-31",
  },
  MX: {
    code: "MX",
    name: "México",
    timeZone: "America/Mexico_City",
    source: "Ley Federal del Trabajo, art. 74 (STPS)",
    sourceUrl: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf",
    coveredThrough: "2027-03-31",
  },
  CO: {
    code: "CO",
    name: "Colombia",
    timeZone: "America/Bogota",
    source: "Ley 51 de 1983 (Ley Emiliani)",
    sourceUrl: "http://www.secretariasenado.gov.co/senado/basedoc/ley_0051_1983.html",
    coveredThrough: "2027-03-31",
  },
  PE: {
    code: "PE",
    name: "Perú",
    timeZone: "America/Lima",
    source: "Decreto Legislativo 713 (gob.pe)",
    sourceUrl: "https://www.gob.pe/feriados",
    coveredThrough: "2027-03-31",
  },
  AR: {
    code: "AR",
    name: "Argentina",
    timeZone: "America/Argentina/Buenos_Aires",
    source: "Ley 27.399 y decretos (Jefatura de Gabinete, Boletín Oficial)",
    sourceUrl: "https://www.argentina.gob.ar/jefatura/feriados-nacionales-2026",
    coveredThrough: "2027-03-31",
  },
};

export const COUNTRY_ORDER: CountryCode[] = ["CL", "MX", "CO", "PE", "AR"];

const CL_LAW = "Leyes de feriados de Chile";
const CL_IRR = "Feriado irrenunciable (Ley 19.973)";
const MX_LAW = "Ley Federal del Trabajo, art. 74";
const MX_NO = "No es descanso obligatorio según la LFT";
const CO_FIX = "Ley 51 de 1983 (fecha fija)";
const CO_MOV = "Ley 51 de 1983 (trasladado al lunes)";
const PE_LAW = "Decreto Legislativo 713 y modificatorias";
const AR_INA = "Ley 27.399 (inamovible)";
const AR_TRA = "Ley 27.399 (trasladable)";
const AR_TUR = "Día no laborable con fines turísticos (opcional para el sector privado)";
const AR_PAPA = "Decreto 1103/2026 (visita del papa León XIV)";
const LOW_YEAR_END = "Víspera de fiesta: muchas empresas trabajan media jornada";

function h(country: CountryCode, kind: HolidayKind, legal: string, rows: [string, string, string?][]): Holiday[] {
  return rows.map(([date, name, regions]) => ({ date, country, name, kind, legal, ...(regions ? { regions } : {}) }));
}

export const HOLIDAYS: Holiday[] = [
  // ── Chile 2026 ───────────────────────────────────────────────────────────
  ...h("CL", "national", CL_IRR, [
    ["2026-01-01", "Año Nuevo"],
    ["2026-05-01", "Día del Trabajo"],
    ["2026-09-18", "Independencia Nacional"],
    ["2026-09-19", "Día de las Glorias del Ejército"],
    ["2026-12-25", "Navidad"],
  ]),
  ...h("CL", "national", CL_LAW, [
    ["2026-04-03", "Viernes Santo"],
    ["2026-04-04", "Sábado Santo"],
    ["2026-05-21", "Día de las Glorias Navales"],
    ["2026-06-21", "Día Nacional de los Pueblos Indígenas"],
    ["2026-06-29", "San Pedro y San Pablo"],
    ["2026-07-16", "Virgen del Carmen"],
    ["2026-08-15", "Asunción de la Virgen"],
    ["2026-10-12", "Encuentro de Dos Mundos"],
    ["2026-10-31", "Día de las Iglesias Evangélicas y Protestantes"],
    ["2026-11-01", "Día de Todos los Santos"],
    ["2026-12-08", "Inmaculada Concepción"],
  ]),
  ...h("CL", "regional", CL_LAW, [
    ["2026-06-07", "Asalto y Toma del Morro de Arica", "Región de Arica y Parinacota"],
    ["2026-08-20", "Natalicio de Bernardo O'Higgins", "Chillán y Chillán Viejo"],
  ]),
  ...h("CL", "low", LOW_YEAR_END, [
    ["2026-12-24", "Nochebuena"],
    ["2026-12-31", "Fin de año"],
  ]),

  // ── México 2026 ──────────────────────────────────────────────────────────
  ...h("MX", "national", MX_LAW, [
    ["2026-01-01", "Año Nuevo"],
    ["2026-02-02", "Día de la Constitución (5 de febrero)"],
    ["2026-03-16", "Natalicio de Benito Juárez (21 de marzo)"],
    ["2026-05-01", "Día del Trabajo"],
    ["2026-09-16", "Día de la Independencia"],
    ["2026-11-16", "Revolución Mexicana (20 de noviembre)"],
    ["2026-12-25", "Navidad"],
  ]),
  ...h("MX", "low", MX_NO, [
    ["2026-04-02", "Jueves Santo"],
    ["2026-04-03", "Viernes Santo"],
    ["2026-11-02", "Día de Muertos"],
    ["2026-12-12", "Día de la Virgen de Guadalupe"],
    ["2026-12-24", "Nochebuena"],
    ["2026-12-31", "Fin de año"],
  ]),

  // ── Colombia 2026 ────────────────────────────────────────────────────────
  ...h("CO", "national", CO_FIX, [
    ["2026-01-01", "Año Nuevo"],
    ["2026-04-02", "Jueves Santo"],
    ["2026-04-03", "Viernes Santo"],
    ["2026-05-01", "Día del Trabajo"],
    ["2026-07-20", "Día de la Independencia"],
    ["2026-08-07", "Batalla de Boyacá"],
    ["2026-12-08", "Inmaculada Concepción"],
    ["2026-12-25", "Navidad"],
  ]),
  ...h("CO", "national", CO_MOV, [
    ["2026-01-12", "Día de los Reyes Magos"],
    ["2026-03-23", "Día de San José"],
    ["2026-05-18", "Ascensión del Señor"],
    ["2026-06-08", "Corpus Christi"],
    ["2026-06-15", "Sagrado Corazón"],
    ["2026-06-29", "San Pedro y San Pablo"],
    ["2026-08-17", "Asunción de la Virgen"],
    ["2026-10-12", "Día de la Raza"],
    ["2026-11-02", "Día de Todos los Santos"],
    ["2026-11-16", "Independencia de Cartagena"],
  ]),
  ...h("CO", "low", LOW_YEAR_END, [
    ["2026-12-24", "Nochebuena"],
    ["2026-12-31", "Fin de año"],
  ]),

  // ── Perú 2026 ────────────────────────────────────────────────────────────
  ...h("PE", "national", PE_LAW, [
    ["2026-01-01", "Año Nuevo"],
    ["2026-04-02", "Jueves Santo"],
    ["2026-04-03", "Viernes Santo"],
    ["2026-05-01", "Día del Trabajo"],
    ["2026-06-07", "Batalla de Arica y Día de la Bandera"],
    ["2026-06-29", "San Pedro y San Pablo"],
    ["2026-07-23", "Día de la Fuerza Aérea"],
    ["2026-07-28", "Fiestas Patrias"],
    ["2026-07-29", "Fiestas Patrias"],
    ["2026-08-06", "Batalla de Junín"],
    ["2026-08-30", "Santa Rosa de Lima"],
    ["2026-10-08", "Combate de Angamos"],
    ["2026-11-01", "Día de Todos los Santos"],
    ["2026-12-08", "Inmaculada Concepción"],
    ["2026-12-09", "Batalla de Ayacucho"],
    ["2026-12-25", "Navidad"],
  ]),
  ...h("PE", "low", LOW_YEAR_END, [
    ["2026-12-24", "Nochebuena"],
    ["2026-12-31", "Fin de año"],
  ]),

  // ── Argentina 2026 ───────────────────────────────────────────────────────
  ...h("AR", "national", AR_INA, [
    ["2026-01-01", "Año Nuevo"],
    ["2026-02-16", "Carnaval"],
    ["2026-02-17", "Carnaval"],
    ["2026-03-24", "Día Nacional de la Memoria por la Verdad y la Justicia"],
    ["2026-04-02", "Día del Veterano y de los Caídos en Malvinas"],
    ["2026-04-03", "Viernes Santo"],
    ["2026-05-01", "Día del Trabajador"],
    ["2026-05-25", "Revolución de Mayo"],
    ["2026-06-20", "Paso a la Inmortalidad del Gral. Manuel Belgrano"],
    ["2026-07-09", "Día de la Independencia"],
    ["2026-12-08", "Inmaculada Concepción"],
    ["2026-12-25", "Navidad"],
  ]),
  ...h("AR", "national", AR_TRA, [
    ["2026-06-15", "Paso a la Inmortalidad del Gral. Güemes (17 de junio)"],
    ["2026-08-17", "Paso a la Inmortalidad del Gral. San Martín"],
    ["2026-10-12", "Día del Respeto a la Diversidad Cultural"],
    ["2026-11-23", "Día de la Soberanía Nacional (20 de noviembre)"],
  ]),
  ...h("AR", "national", AR_PAPA, [["2026-11-09", "Visita del papa León XIV"]]),
  ...h("AR", "regional", AR_PAPA, [
    ["2026-11-10", "Visita del papa León XIV", "Ciudad de Buenos Aires y provincia de Córdoba"],
    ["2026-11-11", "Visita del papa León XIV", "Provincia de Buenos Aires"],
  ]),
  ...h("AR", "low", AR_TUR, [
    ["2026-03-23", "Día no laborable con fines turísticos"],
    ["2026-07-10", "Día no laborable con fines turísticos"],
    ["2026-12-07", "Día no laborable con fines turísticos"],
  ]),
  ...h("AR", "low", LOW_YEAR_END, [
    ["2026-12-24", "Nochebuena"],
    ["2026-12-31", "Fin de año"],
  ]),

  // ── Primer trimestre 2027 ────────────────────────────────────────────────
  // Calculado con las reglas de cada ley (Pascua 2027 = 28 de marzo). Cuando
  // cada gobierno publique su calendario oficial 2027, confirmar y completar
  // el año (y subir coveredThrough en COUNTRIES).
  ...h("CL", "national", CL_IRR, [["2027-01-01", "Año Nuevo"]]),
  ...h("CL", "national", CL_LAW, [
    ["2027-03-26", "Viernes Santo"],
    ["2027-03-27", "Sábado Santo"],
  ]),
  ...h("MX", "national", MX_LAW, [
    ["2027-01-01", "Año Nuevo"],
    ["2027-02-01", "Día de la Constitución (5 de febrero)"],
    ["2027-03-15", "Natalicio de Benito Juárez (21 de marzo)"],
  ]),
  ...h("MX", "low", MX_NO, [
    ["2027-03-25", "Jueves Santo"],
    ["2027-03-26", "Viernes Santo"],
  ]),
  ...h("CO", "national", CO_FIX, [
    ["2027-01-01", "Año Nuevo"],
    ["2027-03-25", "Jueves Santo"],
    ["2027-03-26", "Viernes Santo"],
  ]),
  ...h("CO", "national", CO_MOV, [
    ["2027-01-11", "Día de los Reyes Magos"],
    ["2027-03-22", "Día de San José"],
  ]),
  ...h("PE", "national", PE_LAW, [
    ["2027-01-01", "Año Nuevo"],
    ["2027-03-25", "Jueves Santo"],
    ["2027-03-26", "Viernes Santo"],
  ]),
  ...h("AR", "national", AR_INA, [
    ["2027-01-01", "Año Nuevo"],
    ["2027-02-08", "Carnaval"],
    ["2027-02-09", "Carnaval"],
    ["2027-03-24", "Día Nacional de la Memoria por la Verdad y la Justicia"],
    ["2027-03-26", "Viernes Santo"],
  ]),
  ...h("AR", "low", "Día no laborable (Ley 27.399, opcional para el sector privado)", [["2027-03-25", "Jueves Santo"]]),
];

// Índice por fecha → feriados de ese día (todos los países).
const BY_DATE = new Map<string, Holiday[]>();
for (const x of HOLIDAYS) {
  const list = BY_DATE.get(x.date) ?? [];
  list.push(x);
  BY_DATE.set(x.date, list);
}

export function holidaysOn(date: string, country?: CountryCode): Holiday[] {
  const list = BY_DATE.get(date) ?? [];
  return country ? list.filter((x) => x.country === country) : list;
}

// Nombre de país (de la planilla o de HubSpot, ya normalizado con
// canonicalCountry) → código. Solo los 5 países del calendario.
export function countryCodeFromName(name: string | null | undefined): CountryCode | null {
  const key = (name ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  for (const c of COUNTRY_ORDER) {
    const n = COUNTRIES[c].name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (key === n || key === c.toLowerCase()) return c;
  }
  return null;
}

// Severidad para ordenar y elegir la etiqueta del día: nacional > regional > baja.
export const KIND_RANK: Record<HolidayKind, number> = { national: 3, regional: 2, low: 1 };

export const KIND_LABEL: Record<HolidayKind, string> = {
  national: "Feriado",
  regional: "Feriado regional",
  low: "Baja actividad",
};
