// Tipos, utilidades y lógica compartida entre la página interna de ICP
// (app/configuracion/icp/page.tsx) y el formulario público por link
// (app/forms/icp/[token]/IcpPublicForm.tsx).

export type IcpFormData = {
  // 1. Datos del cliente
  nombre_empresa: string;
  nombre_contacto: string;
  cargo: string;
  email: string;
  descripcion_negocio: string;
  // 2. Perfil de empresa objetivo
  industrias_objetivo: string;
  industrias_excluidas: string;
  tamano_empresa: string[];
  facturacion: string[];
  geografias: string;
  modelo_empresa: string[];
  etapa_empresa: string[];
  // 3. Señales de fit
  senales_positivas: string;
  senales_negativas: string;
  tech_stack: string;
  eventos_disparadores: string;
  // 4. Buyer persona
  cargos_decisores: string;
  cargos_influenciadores: string;
  cargos_evitar: string;
  departamentos: string[];
  seniority: string[];
  perfil_psicografico: string;
  // 5. Propuesta de valor
  propuesta_valor: string;
  problemas: string;
  resultados: string;
  competidores: string;
  diferenciadores: string;
  // 6. Outreach
  tono: string[];
  idioma: string[];
  cta_primer_contacto: string[];
  canales: string[];
  mensajes_exitosos: string;
  objeciones: string;
  // 7. Clientes de referencia
  mejores_clientes: string;
  peores_clientes: string;
  ticket_acv: string;
};

export const EMPTY_FORM: IcpFormData = {
  nombre_empresa: "", nombre_contacto: "", cargo: "", email: "", descripcion_negocio: "",
  industrias_objetivo: "", industrias_excluidas: "", tamano_empresa: [], facturacion: [],
  geografias: "", modelo_empresa: [], etapa_empresa: [],
  senales_positivas: "", senales_negativas: "", tech_stack: "", eventos_disparadores: "",
  cargos_decisores: "", cargos_influenciadores: "", cargos_evitar: "",
  departamentos: [], seniority: [], perfil_psicografico: "",
  propuesta_valor: "", problemas: "", resultados: "", competidores: "", diferenciadores: "",
  tono: [], idioma: [], cta_primer_contacto: [], canales: [],
  mensajes_exitosos: "", objeciones: "",
  mejores_clientes: "", peores_clientes: "", ticket_acv: ""
};

// Opciones de chips
export const TAMANO_OPTS     = ["1–10", "11–50", "51–100", "101–200", "201–500", "501–1.000", "1.000+"];
export const FACTURACION_OPTS = ["< $500K", "$500K–$2M", "$2–10M", "$10–50M", "$50M+"];
export const MODELO_OPTS     = ["B2B", "B2B2C", "SaaS", "Marketplace", "Servicios"];
export const ETAPA_OPTS      = ["Startup", "Scale-up", "Empresa establecida", "Corporativo"];
export const DEPTO_OPTS      = ["Ventas", "Marketing", "Operaciones", "C-Suite", "Revenue Ops", "Producto", "Tecnología", "RRHH", "Canales", "Experiencia del Cliente"];
export const SENIORITY_OPTS  = ["Manager", "Senior Manager", "Director", "VP / Head of", "C-Level", "Founder / Owner"];
export const TONO_OPTS       = ["Formal / corporativo", "Profesional amigable", "Casual / directo", "Consultivo / experto", "Challenger (provocador)"];
export const IDIOMA_OPTS     = ["Español", "Inglés", "Portugués", "Mixto por mercado"];
export const CTA_OPTS        = ["Agendar demo (30 min)", "Llamada rápida (15 min)", "Ver caso de estudio", "Responder pregunta simple", "Diagnóstico gratuito"];
export const CANALES_OPTS    = ["Email frío", "LinkedIn conexión", "LinkedIn mensaje directo", "WhatsApp", "Llamada en frío"];

// ── Serialización a texto (compatible con discovery.ts) ────────────────
export function serializeIcpForm(d: IcpFormData): string {
  function f(label: string, value: string | string[]): string | null {
    const v = Array.isArray(value) ? value.join(", ") : value;
    return v?.trim() ? `[${label}]\n${v.trim()}` : null;
  }
  function section(title: string, fields: (string | null)[]): string | null {
    const body = fields.filter(Boolean).join("\n\n");
    if (!body) return null;
    const sep = "-".repeat(42);
    return `${sep}\n${title}\n${sep}\n\n${body}`;
  }
  return [
    section("DATOS DEL CLIENTE", [
      f("Nombre de la empresa", d.nombre_empresa),
      f("Nombre del contacto", d.nombre_contacto),
      f("Cargo", d.cargo),
      f("Email de contacto", d.email),
      f("Descripción del negocio", d.descripcion_negocio),
    ]),
    section("PERFIL DE EMPRESA OBJETIVO", [
      f("Industrias objetivo", d.industrias_objetivo),
      f("Industrias excluidas", d.industrias_excluidas),
      f("Tamaño (empleados / revenue)", d.tamano_empresa),
      f("Facturación anual estimada", d.facturacion),
      f("Geografías prioritarias", d.geografias),
      f("Modelo de empresa", d.modelo_empresa),
      f("Etapa de la empresa", d.etapa_empresa),
    ]),
    section("SEÑALES DE FIT", [
      f("Señales positivas de fit", d.senales_positivas),
      f("Señales negativas / descalificadores", d.senales_negativas),
      f("Tecnologías / Stack que usa", d.tech_stack),
      f("Eventos disparadores de compra", d.eventos_disparadores),
    ]),
    section("BUYER PERSONA", [
      f("Cargos decisores (quien aprueba)", d.cargos_decisores),
      f("Cargos influenciadores (quien recomienda)", d.cargos_influenciadores),
      f("Cargos a evitar", d.cargos_evitar),
      f("Departamentos objetivo", d.departamentos),
      f("Seniority mínimo", d.seniority),
      f("Perfil psicográfico", d.perfil_psicografico),
    ]),
    section("PROPUESTA DE VALOR", [
      f("Propuesta de valor en 1-2 oraciones", d.propuesta_valor),
      f("Top 3 problemas que resuelves", d.problemas),
      f("Top 3 resultados que entregas", d.resultados),
      f("Competidores principales", d.competidores),
      f("Por qué te eligen vs competencia", d.diferenciadores),
    ]),
    section("OUTREACH Y TONO", [
      f("Tono de comunicación", d.tono),
      f("Idioma del outreach", d.idioma),
      f("CTA del primer contacto", d.cta_primer_contacto),
      f("Canales preferidos", d.canales),
      f("Mensajes que han funcionado", d.mensajes_exitosos),
      f("Objeciones frecuentes y cómo responder", d.objeciones),
    ]),
    section("CLIENTES DE REFERENCIA", [
      f("Mejores clientes actuales o pasados", d.mejores_clientes),
      f("Peores clientes / mal fit", d.peores_clientes),
      f("Ticket / ACV y ciclo de venta", d.ticket_acv),
    ]),
  ].filter(Boolean).join("\n\n");
}

// ── Deserialización desde texto ────────────────────────────────────────
export function extractField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[${escaped}\\]\\s*([\\s\\S]*?)(?=\\n\\[|\\n-{3,}|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

export function chipsFrom(text: string, label: string): string[] {
  const val = extractField(text, label);
  return val ? val.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function deserializeIcpForm(text: string): IcpFormData {
  return {
    nombre_empresa:         extractField(text, "Nombre de la empresa"),
    nombre_contacto:        extractField(text, "Nombre del contacto"),
    cargo:                  extractField(text, "Cargo"),
    email:                  extractField(text, "Email de contacto"),
    descripcion_negocio:    extractField(text, "Descripción del negocio"),
    industrias_objetivo:    extractField(text, "Industrias objetivo"),
    industrias_excluidas:   extractField(text, "Industrias excluidas"),
    tamano_empresa:         chipsFrom(text, "Tamaño (empleados / revenue)"),
    facturacion:            chipsFrom(text, "Facturación anual estimada"),
    geografias:             extractField(text, "Geografías prioritarias"),
    modelo_empresa:         chipsFrom(text, "Modelo de empresa"),
    etapa_empresa:          chipsFrom(text, "Etapa de la empresa"),
    senales_positivas:      extractField(text, "Señales positivas de fit"),
    senales_negativas:      extractField(text, "Señales negativas / descalificadores"),
    tech_stack:             extractField(text, "Tecnologías / Stack que usa"),
    eventos_disparadores:   extractField(text, "Eventos disparadores de compra"),
    cargos_decisores:       extractField(text, "Cargos decisores (quien aprueba)"),
    cargos_influenciadores: extractField(text, "Cargos influenciadores (quien recomienda)"),
    cargos_evitar:          extractField(text, "Cargos a evitar"),
    departamentos:          chipsFrom(text, "Departamentos objetivo"),
    seniority:              chipsFrom(text, "Seniority mínimo"),
    perfil_psicografico:    extractField(text, "Perfil psicográfico"),
    propuesta_valor:        extractField(text, "Propuesta de valor en 1-2 oraciones"),
    problemas:              extractField(text, "Top 3 problemas que resuelves"),
    resultados:             extractField(text, "Top 3 resultados que entregas"),
    competidores:           extractField(text, "Competidores principales"),
    diferenciadores:        extractField(text, "Por qué te eligen vs competencia"),
    tono:                   chipsFrom(text, "Tono de comunicación"),
    idioma:                 chipsFrom(text, "Idioma del outreach"),
    cta_primer_contacto:    chipsFrom(text, "CTA del primer contacto"),
    canales:                chipsFrom(text, "Canales preferidos"),
    mensajes_exitosos:      extractField(text, "Mensajes que han funcionado"),
    objeciones:             extractField(text, "Objeciones frecuentes y cómo responder"),
    mejores_clientes:       extractField(text, "Mejores clientes actuales o pasados"),
    peores_clientes:        extractField(text, "Peores clientes / mal fit"),
    ticket_acv:             extractField(text, "Ticket / ACV y ciclo de venta"),
  };
}

// ── ICP por industria ──────────────────────────────────────────────────
export type IndustrySectionKey =
  | "target_company"
  | "fit_signals"
  | "buyer_persona"
  | "value_prop"
  | "outreach"
  | "reference_clients";

export const INDUSTRY_SECTION_LABELS: Record<IndustrySectionKey, { num: number; title: string; desc: string }> = {
  target_company:   { num: 2, title: "PERFIL DE EMPRESA OBJETIVO",        desc: "Define el tipo ideal de cliente para esta industria" },
  fit_signals:      { num: 3, title: "SEÑALES DE FIT",                    desc: "Señales positivas, descalificadores y triggers" },
  buyer_persona:    { num: 4, title: "BUYER PERSONA",                     desc: "Cargos, departamentos y perfil psicográfico" },
  value_prop:       { num: 5, title: "PROPUESTA DE VALOR",                desc: "Propuesta, problemas, resultados y diferenciadores" },
  outreach:         { num: 6, title: "OUTREACH — TONO Y MENSAJES",        desc: "Tono, canales, mensajes y objeciones" },
  reference_clients:{ num: 7, title: "CLIENTES DE REFERENCIA",            desc: "Mejores y peores clientes, ticket y ciclo" },
};

export const SECTION_FIELDS: Record<IndustrySectionKey, (keyof IcpFormData)[]> = {
  target_company:    ["industrias_objetivo", "industrias_excluidas", "tamano_empresa", "facturacion", "geografias", "modelo_empresa", "etapa_empresa"],
  fit_signals:       ["senales_positivas", "senales_negativas", "tech_stack", "eventos_disparadores"],
  buyer_persona:     ["cargos_decisores", "cargos_influenciadores", "cargos_evitar", "departamentos", "seniority", "perfil_psicografico"],
  value_prop:        ["propuesta_valor", "problemas", "resultados", "competidores", "diferenciadores"],
  outreach:          ["tono", "idioma", "cta_primer_contacto", "canales", "mensajes_exitosos", "objeciones"],
  reference_clients: ["mejores_clientes", "peores_clientes", "ticket_acv"],
};

export function serializeSectionForm(sectionKey: IndustrySectionKey, form: IcpFormData): string {
  const partial: IcpFormData = { ...EMPTY_FORM };
  for (const key of SECTION_FIELDS[sectionKey]) {
    (partial as Record<string, unknown>)[key] = form[key as keyof IcpFormData];
  }
  return serializeIcpForm(partial);
}

export function emptySectionForm(): IcpFormData {
  return { ...EMPTY_FORM };
}

// ── Parser de JSON exportado desde el formulario HTML standalone ───────
export function parseFormJson(json: Record<string, unknown>): IcpFormData {
  function str(sec: string, key: string): string {
    const section = json[sec] as Record<string, unknown> | undefined;
    if (!section) return "";
    const val = section[key];
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.join(", ");
    return "";
  }
  function arr(sec: string, key: string, filter?: string[]): string[] {
    const section = json[sec] as Record<string, unknown> | undefined;
    if (!section) return [];
    const val = section[key];
    const list: string[] = Array.isArray(val)
      ? val
      : typeof val === "string"
      ? val.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    return filter ? list.filter((v) => filter.includes(v)) : list;
  }
  const allModeloEtapa = arr("perfil_empresa", "Modelo y etapa de la empresa");
  return {
    nombre_empresa:         str("datos_cliente", "Nombre de la empresa"),
    nombre_contacto:        str("datos_cliente", "Nombre del contacto"),
    cargo:                  str("datos_cliente", "Cargo"),
    email:                  str("datos_cliente", "Email de contacto"),
    descripcion_negocio:    str("datos_cliente", "Descripción breve del negocio"),
    industrias_objetivo:    str("perfil_empresa", "Industrias objetivo"),
    industrias_excluidas:   str("perfil_empresa", "Industrias excluidas"),
    tamano_empresa:         arr("perfil_empresa", "Tamaño de empresa (empleados)"),
    facturacion:            arr("perfil_empresa", "Facturación anual estimada"),
    geografias:             str("perfil_empresa", "Geografías objetivo"),
    modelo_empresa:         allModeloEtapa.filter((v) => MODELO_OPTS.includes(v)),
    etapa_empresa:          allModeloEtapa.filter((v) => ETAPA_OPTS.includes(v)),
    senales_positivas:      str("senales_fit", "Señales positivas de fit"),
    senales_negativas:      str("senales_fit", "Señales negativas / descalificadores"),
    tech_stack:             str("senales_fit", "Tech stack / herramientas que usa tu cliente ideal"),
    eventos_disparadores:   str("senales_fit", "Eventos disparadores de compra"),
    cargos_decisores:       str("buyer_persona", "Cargos decisores (quien aprueba)"),
    cargos_influenciadores: str("buyer_persona", "Cargos influenciadores (quien recomienda)"),
    cargos_evitar:          str("buyer_persona", "Cargos a evitar"),
    departamentos:          arr("buyer_persona", "Departamentos objetivo"),
    seniority:              arr("buyer_persona", "Seniority mínimo"),
    perfil_psicografico:    str("buyer_persona", "Perfil psicográfico del buyer"),
    propuesta_valor:        str("propuesta_valor", "Propuesta de valor en 1–2 oraciones"),
    problemas:              str("propuesta_valor", "Top 3 problemas que resuelves"),
    resultados:             str("propuesta_valor", "Top 3 resultados que entregas"),
    competidores:           str("propuesta_valor", "Principales competidores"),
    diferenciadores:        str("propuesta_valor", "Por qué te eligen vs. la competencia"),
    tono:                   arr("outreach", "Tono de comunicación"),
    idioma:                 arr("outreach", "Idioma principal del outreach"),
    cta_primer_contacto:    arr("outreach", "CTA del primer contacto"),
    canales:                arr("outreach", "Canales preferidos"),
    mensajes_exitosos:      str("outreach", "Mensajes que han funcionado (ejemplos reales)"),
    objeciones:             str("outreach", "Objeciones frecuentes y cómo las manejas"),
    mejores_clientes:       str("clientes_referencia", "Top 3–5 mejores clientes actuales o pasados"),
    peores_clientes:        str("clientes_referencia", "Peores clientes / mal fit"),
    ticket_acv:             str("clientes_referencia", "Ticket / ACV y ciclo de venta"),
  };
}
