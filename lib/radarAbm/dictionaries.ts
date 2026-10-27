import type { RadarConfig } from "./types";

// Radar ABM — diccionarios oficiales (textos exactos de HubSpot) y valores
// por defecto de la configuración. Ver §4 del prompt maestro y el prototipo
// Radar_ABM_BullsEye_BETA.html.

// ── Asignación BullsEye por Llamar (contacto) ────────────────────────────
export const PEND = new Set(["Hot Calling 🔥", "Por gestionar", "Buscar"]);
export const PAUSA = "No gestionar - Reunión Agendada con la Empresa";
// Contacto efectivo (= conversación)
export const EFF = new Set([
  "Hacer Seguimiento",
  "Gestionado - No Interesado",
  "Reunión Agendada",
  "Refiere con el Tomador de Decisiones",
  "Contacto No Fit para gestión",
  "NO gestionar",
]);
export const POS = new Set(["Reunión Agendada", "Hacer Seguimiento", "Refiere con el Tomador de Decisiones"]);
export const REJ = new Set(["Gestionado - No Interesado", "NO gestionar"]);

// Grupos analíticos (color = variable CSS del módulo)
export const G: Record<string, { l: string; c: string }> = {
  pend: { l: "Pendientes", c: "var(--g-pend)" },
  act: { l: "Gestión activa", c: "var(--g-act)" },
  int: { l: "Interés / avance", c: "var(--g-int)" },
  fut: { l: "Interés futuro", c: "var(--g-fut)" },
  rej: { l: "Rechazo", c: "var(--g-rej)" },
  cont: { l: "Problema de contactabilidad", c: "var(--g-cont)" },
  disp: { l: "Problema de disponibilidad ICP", c: "var(--g-disp)" },
  icp: { l: "Fuera de ICP", c: "var(--g-icp)" },
  rel: { l: "Relación existente", c: "var(--g-rel)" },
  rec: { l: "Reciclaje / nueva prospección", c: "var(--g-rec)" },
  pos: { l: "Resultado positivo", c: "var(--g-int)" },
  cal: { l: "Calidad del contacto", c: "var(--g-icp)" },
  canal: { l: "Cambio de canal", c: "var(--g-act)" },
  pausa: { l: "Pausa por reunión de la empresa (sin grupo oficial)", c: "var(--g-pausa)" },
  dispc: { l: "Disponibilidad de contacto", c: "var(--g-disp)" },
};

// ── Status de la asignación - SDR (empresa) ──────────────────────────────
// "CONV" = "En conversaciones con [cliente]" normalizado a una sola clave
export const CO_ORDER = [
  "Asignada", "En gestión", "Gestionada por LinkedIn", "En seguimiento", "Reunión Agendada", "CONV",
  "Sin interés ahora - Retomar", "No interesados", "Gestionada - sin comunicación", "Nutrir",
  "Gestionada - sin contactos fit", "Sin contactos - (ya nutrida)", "No califica", "Clientes", "Empresa ya nutrida",
];
export const CO_G: Record<string, string[]> = {
  "Asignada": ["pend"],
  "En gestión": ["act"],
  "Gestionada por LinkedIn": ["act", "rec"],
  "En seguimiento": ["int"],
  "Reunión Agendada": ["int"],
  "CONV": ["rel", "int"],
  "Sin interés ahora - Retomar": ["fut"],
  "No interesados": ["rej"],
  "Gestionada - sin comunicación": ["cont"],
  "Nutrir": ["cont", "rec"],
  "Gestionada - sin contactos fit": ["disp"],
  "Sin contactos - (ya nutrida)": ["disp", "rec"],
  "No califica": ["icp"],
  "Clientes": ["rel"],
  "Empresa ya nutrida": ["rec"],
};
export const CT_ORDER = [
  "Hot Calling 🔥", "Por gestionar", "Buscar", "Reunión Agendada", "Hacer Seguimiento",
  "Refiere con el Tomador de Decisiones", "Gestionado - No Interesado", "NO gestionar",
  "Contacto No Fit para gestión", "No Contestó", "Sin Información de Contacto", "En Gestión LinkedIn", PAUSA,
];
export const CT_G: Record<string, string> = {
  "Hot Calling 🔥": "pend", "Por gestionar": "pend", "Buscar": "pend",
  "Reunión Agendada": "pos", "Hacer Seguimiento": "pos", "Refiere con el Tomador de Decisiones": "pos",
  "Gestionado - No Interesado": "rej", "NO gestionar": "rej",
  "Contacto No Fit para gestión": "cal", "No Contestó": "cont", "Sin Información de Contacto": "dispc",
  "En Gestión LinkedIn": "canal", [PAUSA]: "pausa",
};

export const coKey = (st: string) => (st.startsWith("En conversaciones") ? "CONV" : st);

// Muestra mínima para concluir (contactos efectivos por segmento de rol)
export const MIN_N = 10;

// ── Health Score (§6) ────────────────────────────────────────────────────
export const HEALTH_COMPONENTS: { key: string; name: string; formula: string }[] = [
  { key: "coverage", name: "Cobertura de cuentas", formula: "Empresas trabajadas / universo" },
  { key: "contactRate", name: "Contactabilidad", formula: "Contactos efectivos / contactos gestionados" },
  { key: "convToMeet", name: "Conversión a reunión", formula: "Empresas con reunión / empresas con conversación relevante" },
  { key: "realization", name: "Realización de reuniones", formula: "Realizadas / (realizadas + no-show + canceladas)" },
  { key: "quality", name: "Calidad de reuniones", formula: "(Alta + ½ Media) / reuniones evaluables (mín. 5)" },
  { key: "followup", name: "Disciplina de seguimiento", formula: "Seguimientos al día y con fecha / total seguimientos" },
  { key: "multi", name: "Multi-threading", formula: "Empresas con 2+ contactos efectivos / empresas con contacto efectivo" },
  { key: "opp", name: "Oportunidades", formula: "Empresas con oportunidad / empresas con reunión realizada (mín. 3)" },
  { key: "icpFit", name: "Ajuste ICP de la base", formula: "1 − (no califica + sin contactos fit) / empresas trabajadas" },
  { key: "trend", name: "Tendencia", formula: "Reuniones agendadas últimos 3 meses vs 3 previos (mes en curso normalizado)" },
];

// ── Tabla de cargos → área / seniority (§3.2, editable) ──────────────────
// Se evalúan en orden: gana la primera palabra clave que aparezca en el
// cargo (sin tildes, minúsculas). Una regla puede definir solo área o solo
// seniority.
export const DEFAULT_TITLE_RULES: RadarConfig["titleRules"] = [
  // Seniority
  { kw: "ceo", sen: "C-Level" }, { kw: "cio", sen: "C-Level" }, { kw: "cto", sen: "C-Level" },
  { kw: "coo", sen: "C-Level" }, { kw: "cfo", sen: "C-Level" }, { kw: "cmo", sen: "C-Level" },
  { kw: "cdo", sen: "C-Level" }, { kw: "chief", sen: "C-Level" }, { kw: "gerente general", sen: "C-Level" },
  { kw: "director ejecutivo", sen: "C-Level" }, { kw: "presidente", sen: "C-Level" }, { kw: "country manager", sen: "C-Level" },
  { kw: "vicepresidente", sen: "Director" }, { kw: "vp", sen: "Director" }, { kw: "director", sen: "Director" }, { kw: "head", sen: "Director" },
  { kw: "brand manager", sen: "Especialista" }, { kw: "subgerente", sen: "Gerente" }, { kw: "gerente", sen: "Gerente" }, { kw: "manager", sen: "Gerente" }, { kw: "controller", sen: "Gerente" },
  { kw: "jefe", sen: "Jefatura" }, { kw: "jefa", sen: "Jefatura" }, { kw: "lider", sen: "Jefatura" }, { kw: "lead", sen: "Jefatura" },
  { kw: "coordinador", sen: "Jefatura" }, { kw: "supervisor", sen: "Jefatura" },
  // Área
  { kw: "gerente general", area: "Gerencia General" }, { kw: "ceo", area: "Gerencia General" },
  { kw: "director ejecutivo", area: "Gerencia General" }, { kw: "presidente", area: "Gerencia General" },
  { kw: "country manager", area: "Gerencia General" }, { kw: "socio", area: "Gerencia General" }, { kw: "fundador", area: "Gerencia General" },
  { kw: "cio", area: "Tecnología" }, { kw: "cto", area: "Tecnología" }, { kw: "cdo", area: "Tecnología" },
  { kw: "tecnologia", area: "Tecnología" }, { kw: "ti", area: "Tecnología" }, { kw: "it", area: "Tecnología" },
  { kw: "sistemas", area: "Tecnología" }, { kw: "transformacion digital", area: "Tecnología" }, { kw: "infraestructura", area: "Tecnología" },
  { kw: "desarrollo", area: "Tecnología" }, { kw: "arquitect", area: "Tecnología" }, { kw: "software", area: "Tecnología" },
  { kw: "datos", area: "Tecnología" }, { kw: "data", area: "Tecnología" }, { kw: "innovacion", area: "Tecnología" },
  { kw: "coo", area: "Operaciones" }, { kw: "operaciones", area: "Operaciones" }, { kw: "procesos", area: "Operaciones" },
  { kw: "logistica", area: "Operaciones" }, { kw: "produccion", area: "Operaciones" }, { kw: "abastecimiento", area: "Operaciones" },
  { kw: "cfo", area: "Finanzas" }, { kw: "finanzas", area: "Finanzas" }, { kw: "contab", area: "Finanzas" },
  { kw: "controller", area: "Finanzas" }, { kw: "administracion", area: "Finanzas" }, { kw: "tesorer", area: "Finanzas" },
  { kw: "cmo", area: "Marketing" }, { kw: "marketing", area: "Marketing" }, { kw: "marca", area: "Marketing" }, { kw: "brand", area: "Marketing" },
  { kw: "ventas", area: "Comercial" }, { kw: "comercial", area: "Comercial" }, { kw: "kam", area: "Comercial" },
  { kw: "canal", area: "Comercial" }, { kw: "negocios", area: "Comercial" }, { kw: "sales", area: "Comercial" },
  { kw: "rrhh", area: "RRHH" }, { kw: "recursos humanos", area: "RRHH" }, { kw: "personas", area: "RRHH" },
  { kw: "seleccion", area: "RRHH" }, { kw: "talento", area: "RRHH" }, { kw: "people", area: "RRHH" },
];

// Propiedades de HubSpot: clave interna → etiqueta que se busca en el portal
// para detectar el nombre interno automáticamente (§3.1, se confirma en
// Configuración del Radar ABM).
// perClient: en el HubSpot hay una propiedad por cliente ("Status de la
// asignación - DSAC", "Status de la asignación - SDR AcidLab"…, nombres
// internos status_de_la_asignacion_*): se elige la que calza con el cliente.
export const PROPERTY_DEFS: {
  key: string;
  object: "companies" | "contacts" | "meetings";
  label: string;
  required?: boolean;
  help: string;
  perClient?: { labelPrefix: string; namePrefix?: string };
}[] = [
  { key: "companyStatus", object: "companies", label: "Status de la asignación - <cliente>", required: true, help: "Estado de gestión de la cuenta (una propiedad por cliente)", perClient: { labelPrefix: "Status de la asignación", namePrefix: "status_de_la_asignacion" } },
  { key: "companyClient", object: "companies", label: "Cliente BullsEye", help: "Opcional: filtro adicional del universo" },
  { key: "companySdr", object: "companies", label: "SDR - <cliente>", help: "SDR de la cuenta (una por cliente; sin ella, el propietario)", perClient: { labelPrefix: "SDR -" } },
  { key: "companyAssignedAt", object: "companies", label: "Fecha de asignación", help: "Sin ella se usa la fecha de creación" },
  { key: "companyNextFollowUp", object: "companies", label: "Fecha de próximo seguimiento", help: "Empresas en seguimiento o por retomar" },
  { key: "companyIcpTier", object: "companies", label: "Tier ICP", help: "A / B / C (propuesta, Anexo A4)" },
  { key: "companyCountry", object: "companies", label: "País", help: "Sin ella se usa country" },
  { key: "contactStatus", object: "contacts", label: "Asignación BullsEye por Llamar - <cliente>", required: true, help: "Estado de gestión del contacto (una propiedad por cliente)", perClient: { labelPrefix: "Asignación BullsEye por Llamar" } },
  { key: "contactSdr", object: "contacts", label: "SDR Asignado - <cliente>", help: "SDR del contacto (una por cliente; sin ella, el propietario)", perClient: { labelPrefix: "SDR Asignado" } },
  { key: "contactObjection", object: "contacts", label: "Objeción principal", help: "Propuesta (Anexo A4)" },
  { key: "contactSignal", object: "contacts", label: "Señal de interés", help: "Propuesta (Anexo A4)" },
  { key: "meetingResult", object: "meetings", label: "Resultado de la reunión", help: "Propuesta (Anexo A4)" },
  { key: "meetingFeedback", object: "meetings", label: "Feedback del cliente", help: "Propuesta (Anexo A4)" },
  { key: "meetingNeed", object: "meetings", label: "Necesidad", help: "Necesidad detectada en la reunión" },
];

// ── "La Biblia" BullsEye (docs/radar-abm/biblia-propiedades-*.csv) ───────
// Etiquetas antiguas de "Asignación BullsEye por Llamar" que siguen vivas en
// algunas propiedades por cliente → etiqueta actual del diccionario.
export const CT_ALIASES: Record<string, string> = {
  "Por Llamar": "Por gestionar",
  "Llamada Completada - No Interesado": "Gestionado - No Interesado",
  "No Contestó la Llamada": "No Contestó",
  "Contacto No Fit para Llamada": "Contacto No Fit para gestión",
  "No Llamar - Reunión Agendada con la Empresa": PAUSA,
  "NO Llamar": "NO gestionar",
};

// Definición oficial de cada status de empresa
export const CO_DEFS: Record<string, string> = {
  "Asignada": "Empresa asignada a SDR; todavía no se busca teléfono ni se comienza a trabajar.",
  "En gestión": "El SDR toma la empresa y la trabaja: busca teléfonos e intenta llamar. No sale de este status hasta tener respuesta o agotar los intentos con todos los contactos.",
  "En seguimiento": "Un tomador de decisión pide que lo llamen en una fecha determinada, o ya hay conversación por WhatsApp.",
  "Empresa ya nutrida": "Prospección o KAM la nutrió con contactos nuevos; el SDR puede volver a tomarla como si fuera asignada.",
  "Sin interés ahora - Retomar": "Un tomador de decisión no está interesado por ahora y pide retomar más adelante.",
  "No califica": "El SDR considera que la empresa no cumple el ICP del cliente (después de alguna llamada o viendo la empresa).",
  "No interesados": "Un tomador de decisión indica que no está interesado.",
  "Reunión Agendada": "Reunión agendada con algún contacto de la empresa.",
  "Gestionada - sin contactos fit": "El SDR no encuentra contactos que formen parte del ICP (no aplica cuando solo faltan teléfonos).",
  "Gestionada - sin comunicación": "El SDR intentó con todos los contactos ICP en HubSpot sin respuesta (por llamadas o por no conseguir teléfono).",
  "Gestionada por LinkedIn": "Tras intentar con todos los contactos por teléfono o WhatsApp, se intenta con el tomador de decisión por LinkedIn.",
  "CONV": "Un tomador de decisión indica que ya están en contacto con el cliente de BullsEye.",
  "Nutrir": "No se logró contactar a nadie de la empresa; se vuelve a prospectar.",
  "Clientes": "En la llamada el SDR descubre que la empresa ya es cliente del cliente de BullsEye.",
  "Sin contactos - (ya nutrida)": "Prospección la nutrió, pero no encontró ningún contacto nuevo relevante para el ICP.",
};

// Definición oficial de cada status de contacto
export const CT_DEFS: Record<string, string> = {
  "Hot Calling 🔥": "Contacto asignado para gestión inmediata (el mismo día de la asignación).",
  "Por gestionar": "Ya se intentó contactar por primera vez o se sigue buscando el teléfono.",
  "Hacer Seguimiento": "Llamada completada y el contacto pide que lo llamen más adelante, no está interesado ahora pero se deja tarea, o pide información por correo.",
  "Buscar": "Se deja para búsqueda masiva de teléfonos.",
  "Gestionado - No Interesado": "El contacto expresa que no está interesado en el servicio.",
  "Reunión Agendada": "Se concretó una reunión con el contacto.",
  "Sin Información de Contacto": "No se logró obtener un teléfono.",
  "No Contestó": "Tras 10 intentos en distintos días y horarios, el contacto no respondió.",
  "Refiere con el Tomador de Decisiones": "No es la persona adecuada y entrega teléfono, correo o nombre del responsable.",
  "Contacto No Fit para gestión": "No es la persona adecuada y no entrega información del encargado.",
  [PAUSA]: "Un cliente de BullsEye pide no seguir contactando porque la empresa ya tiene una reunión programada.",
  "NO gestionar": "El contacto pide expresamente que no se le vuelva a contactar.",
  "En Gestión LinkedIn": "No es posible contactarlo por otros canales; se inicia la gestión por LinkedIn.",
};

// "Resultado de la llamada": disposiciones que son conversación real
export const CONNECTED_DISPOSITION = /^conectad/i;
// "Tipo de llamada": actividades registradas como llamada que son de otro canal
export const callChannel = (type: string | null | undefined): "wa" | "li" | null => {
  const t = (type ?? "").toLowerCase();
  return t.includes("whats") ? "wa" : t.includes("linkedin") ? "li" : null;
};

export const DEFAULT_CONFIG: RadarConfig = {
  health: {
    coverage: { weight: 10, target: 0.95 },
    contactRate: { weight: 12, target: 0.45 },
    convToMeet: { weight: 15, target: 0.5 },
    realization: { weight: 12, target: 0.9 },
    quality: { weight: 8, target: 0.75 },
    followup: { weight: 10, target: 0.9 },
    multi: { weight: 10, target: 0.6 },
    opp: { weight: 13, target: 0.35 },
    icpFit: { weight: 5, target: 0.95 },
    trend: { weight: 5, target: 1 },
  },
  sizeTiers: { pymeMax: 200, midMax: 1000 },
  titleRules: DEFAULT_TITLE_RULES,
  properties: {},
  periodMonths: 6,
  definitions: { companies: CO_DEFS, contacts: CT_DEFS },
  contactAliases: CT_ALIASES,
};

// Mezcla la configuración guardada con los valores por defecto (campos
// nuevos o faltantes no rompen el cálculo).
export function mergeConfig(saved: Partial<RadarConfig> | null | undefined): RadarConfig {
  const s = saved ?? {};
  const health: RadarConfig["health"] = {};
  for (const c of HEALTH_COMPONENTS) {
    const d = DEFAULT_CONFIG.health[c.key];
    const v = s.health?.[c.key];
    health[c.key] = {
      weight: Number.isFinite(v?.weight) ? Number(v!.weight) : d.weight,
      target: Number.isFinite(v?.target) && Number(v!.target) > 0 ? Number(v!.target) : d.target,
    };
  }
  return {
    health,
    sizeTiers: {
      pymeMax: Number(s.sizeTiers?.pymeMax) || DEFAULT_CONFIG.sizeTiers.pymeMax,
      midMax: Number(s.sizeTiers?.midMax) || DEFAULT_CONFIG.sizeTiers.midMax,
    },
    titleRules: Array.isArray(s.titleRules) && s.titleRules.length ? s.titleRules : DEFAULT_TITLE_RULES,
    properties: { ...(s.properties ?? {}) },
    periodMonths: [3, 6, 12].includes(Number(s.periodMonths)) ? Number(s.periodMonths) : DEFAULT_CONFIG.periodMonths,
    // Definiciones editables (nuevo modelo de trabajo): lo guardado manda,
    // lo que falta se completa con La Biblia
    definitions: {
      companies: { ...CO_DEFS, ...cleanText(s.definitions?.companies, CO_ORDER) },
      contacts: { ...CT_DEFS, ...cleanText(s.definitions?.contacts, CT_ORDER) },
    },
    contactAliases: s.contactAliases && typeof s.contactAliases === "object" ? cleanAliases(s.contactAliases) : CT_ALIASES,
  };
}

// Solo estados conocidos y textos acotados
function cleanText(v: unknown, keys: string[]): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k, t]) => keys.includes(k) && typeof t === "string")
      .map(([k, t]) => [k, (t as string).trim().slice(0, 600)])
  );
}
function cleanAliases(v: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([from, to]) => from.trim() && typeof to === "string" && CT_ORDER.includes(to))
      .map(([from, to]) => [from.trim().slice(0, 120), to as string])
  );
}
