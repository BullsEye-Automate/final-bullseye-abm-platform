// Plan del Onboarding SDR (90 días): etapas, hitos y reglas de quién marca y
// quién confirma cada uno. Es la ÚNICA fuente: la página HTML
// (content/onboarding-sdr/onboarding.html) lo recibe inyectado y el servidor
// lo usa para validar cada cambio. Para cambiar un hito, editarlo aquí.
//
// Campos de un hito:
//   e: etapa (índice de STAGES) · c: categoría · d: día interno (solo para
//   ubicar la semana) · g: tipo (acc, agenda, cap, gate, pit, acad) ·
//   v: "doble" = doble verificación · vb: quién confirma (texto) ·
//   cb: roles que confirman · rh: lo confirma RRHH · lo: lo marca la líder ·
//   alias: si el hito con ese id está marcado, este también ·
//   k: palabras para reconocer el evento en el Google Calendar del SDR.

export type Role = "sdr" | "lider" | "rrhh" | "hab";
export const ROLES: Role[] = ["sdr", "lider", "rrhh", "hab"];
export const ROLE_LABEL: Record<Role, string> = {
  sdr: "SDR",
  lider: "Líder de célula",
  rrhh: "RRHH",
  hab: "Habilitadora comercial",
};

export type Stage = { n: string; wk?: string; w?: number; conf?: 1 };
export type Hito = {
  id: string;
  e: number;
  c: string;
  d: number;
  t: string;
  w: string;
  x?: string;
  g?: "acc" | "agenda" | "cap" | "gate" | "pit" | "acad";
  v?: "doble";
  vb?: string;
  cb?: Role[];
  rh?: 1;
  lo?: 1;
  alias?: string;
  crit?: string[];
  k?: string[];
};

export const STAGES: Stage[] = [
  { n: "Antes de entrar", wk: "Previa al ingreso" },
  { n: "Semana 1 · Inducción", w: 1, conf: 1 },
  { n: "Semana 1 · Capacitación", w: 1, conf: 1 },
  { n: "Semana 2", w: 2, conf: 1 },
  { n: "Mes 1", wk: "Semanas 3 a 5" },
  { n: "Mes 2", wk: "Semanas 5 a 9" },
  { n: "Mes 3", wk: "Semanas 9 a 13" },
];

const L = "Líder de célula";
export const HAB_NAME = "Tatiana Zavala";
const T = HAB_NAME;
const TL = "tu líder de célula";

export const HITOS: Hito[] = [
  { id: "p1", e: 0, c: "Ingreso", d: -5, t: "Firmar la carta oferta", w: "JP (RRHH)", x: "Confirma tu fecha de ingreso.", rh: 1 },
  { id: "p4", e: 0, c: "Ingreso", d: -1, t: "Recibir y aceptar la agenda de la semana 1", w: "JP y tu líder", x: "Todas las invitaciones aceptadas en Google Calendar.", rh: 1 },
  { id: "acc-mail", e: 0, c: "Accesos", d: -2, g: "acc", t: "Correo corporativo", w: T, x: "[inicial][apellido]@bullseye-abm.com", rh: 1 },
  { id: "acc-hs", e: 0, c: "Accesos", d: -1, g: "acc", t: "HubSpot CRM", w: "KAM de la cuenta", x: "Acceso a la cuenta de tu cliente.", rh: 1 },
  { id: "acc-allo", e: 0, c: "Accesos", d: -1, g: "acc", t: "Allo", w: "Adolfo Madriz", x: "Marcación y grabación de llamadas.", rh: 1 },
  { id: "acc-agente", e: 0, c: "Accesos", d: -1, g: "acc", t: "Agente de Contenido", w: "Jaime Guajardo", x: "Copys y secuencias.", rh: 1 },
  { id: "acc-portal", e: 0, c: "Accesos", d: -1, g: "acc", t: "Portal BullsEye", w: "Líder de célula", x: "Incluye el buscador / enriquecedor de teléfonos y el Dashboard SDR / Análisis SDR.", rh: 1 },

  { id: "d1", e: 1, c: "Bienvenida", d: 1, g: "agenda", t: "Bienvenida oficial", w: "JP + Tatiana", x: "Virtual · Google Meet. Cultura, entrega de accesos y bienvenida general.", k: ["bienvenida"] },
  { id: "acc-wsp", e: 1, c: "Bienvenida", d: 1, g: "acc", t: "Grupo WhatsApp «Operatividad - BullsEye»", w: T, x: "Avisos del día a día." },
  { id: "d3", e: 1, c: "Bienvenida", d: 1, g: "agenda", t: "Reunión inicial con tu líder de célula", w: L, x: "Tu rol, expectativas, dinámica de la célula, curva de metas y agenda de la semana.", k: ["reunion inicial", "reunión inicial", "kick off sdr", "lider de celula", "líder de célula"] },
  { id: "s1", e: 1, c: "Conoce BullsEye", d: 2, g: "agenda", t: "Historia, misión, propósito y 6 valores", w: "Cote Karmy (fundador)", x: "Presencial · oficina. Cómo nació BullsEye y cómo trabajamos.", k: ["historia", "mision", "proposito", "valores", "cultura"] },
  { id: "s2", e: 1, c: "Conoce BullsEye", d: 2, g: "agenda", t: "Administración, pagos y beneficios", w: "Colomba Ruiz (Finanzas)", x: "Presencial · oficina. Fechas y procesos de pago, beneficios.", k: ["administracion", "pagos", "beneficios", "finanzas"] },
  { id: "s3", e: 1, c: "Conoce BullsEye", d: 2, g: "agenda", t: "Marketing, Contenido y Estrategia", w: "Jaime Guajardo", x: "Presencial · oficina. Incluye la presentación del Agente de Contenido.", k: ["marketing", "agente de contenido"] },
  { id: "s4", e: 1, c: "Conoce BullsEye", d: 2, g: "agenda", t: "Cómo funciona Operaciones: células, KAM y clientes", w: "Ingri Hincapié", x: "Oficina o Meet.", k: ["operaciones"] },
  { id: "s6", e: 1, c: "Conoce BullsEye", d: 2, g: "agenda", t: "Prospección y bases", w: "Adolfo Madriz", x: "Oficina o Meet. Equipo de Prospección, inyección de bases y asignación semanal.", k: ["prospeccion", "bases"] },

  { id: "d4a", e: 2, c: "Herramientas", d: 1, g: "cap", t: "HubSpot · listas", w: T, x: "Validación: creas una lista de contactos de tu cliente.", v: "doble", alias: "d4", k: ["hubspot"] },
  { id: "d4b", e: 2, c: "Herramientas", d: 1, g: "cap", t: "HubSpot · fichas de empresa y contacto", w: T, x: "Validación: creas una ficha de empresa y una de contacto de prueba.", v: "doble", alias: "d4", k: ["hubspot"] },
  { id: "d4c", e: 2, c: "Herramientas", d: 1, g: "cap", t: "HubSpot · registro de actividades", w: T, x: "Validación: registras una actividad de prueba.", v: "doble", alias: "d4", k: ["hubspot"] },
  { id: "s8a", e: 2, c: "Herramientas", d: 3, g: "cap", t: "HubSpot · agendamiento de reuniones", w: T, x: "Validación: registras una reunión de prueba en HubSpot.", v: "doble", alias: "s8", k: ["agendamiento", "hubspot"] },
  { id: "s8b", e: 2, c: "Herramientas", d: 3, g: "cap", t: "Formulario interno de registro de reuniones", w: L, x: "Validación: registras la misma reunión de prueba en el formulario.", v: "doble", alias: "s8", k: ["formulario", "registro de reuniones"] },
  { id: "cap-tel", e: 2, c: "Herramientas", d: 2, g: "cap", t: "Portal BullsEye · buscador / enriquecedor de teléfonos", w: L, x: "Validación: obtienes el celular directo de un contacto de tu cliente.", v: "doble", k: ["telefonos", "enriquecedor", "portal"] },
  { id: "s8c", e: 2, c: "Herramientas", d: 3, g: "cap", t: "Portal BullsEye · Dashboard SDR / Análisis SDR", w: T, x: "Validación: encuentras tus métricas en el dashboard y explicas qué mide cada indicador.", v: "doble", alias: "s8", k: ["dashboard", "analisis sdr"] },
  { id: "s9", e: 2, c: "Herramientas", d: 3, g: "cap", t: "Allo: marcación y grabaciones", w: "Adolfo Madriz", x: "Validación: haces una llamada de prueba.", v: "doble", k: ["allo"] },
  { id: "s5", e: 2, c: "Rol y método", d: 2, g: "cap", t: "Rol del SDR, flujo de trabajo y organización de agenda", w: L, x: "Validación: explicas el flujo de una cuenta de punta a punta.", v: "doble", k: ["rol del sdr", "flujo de trabajo"] },
  { id: "s10", e: 2, c: "Rol y método", d: 3, g: "cap", t: "Venta consultiva, guion y reunión calificada", w: L, x: "Validación: distingues una reunión calificada de una exploratoria.", v: "doble", k: ["venta consultiva", "guion", "reunion calificada"] },
  { id: "s12", e: 2, c: "Rol y método", d: 4, g: "cap", t: "Escuchar llamadas grabadas de SDR destacadas", w: L, x: "Validación: anotas 3 buenas prácticas.", v: "doble", k: ["llamadas grabadas", "escucha"] },
  { id: "s13", e: 2, c: "Rol y método", d: 4, g: "cap", t: "Objeciones, agendamiento y confirmación", w: L, x: "Validación: respondes las 5 objeciones más frecuentes.", v: "doble", k: ["objeciones"] },
  { id: "s14", e: 2, c: "Rol y método", d: 5, g: "cap", t: "Roleplays de llamada en frío", w: L, x: "Apertura, gancho, calificación, objeción y cierre con agenda. La cantidad la define tu líder.", v: "doble", k: ["roleplay", "role play"] },
  { id: "kam", e: 2, c: "Tus clientes", d: 4, g: "cap", t: "Presentación de tus clientes y su propuesta de valor", w: "KAM", vb: TL, x: "Validación: explicas la propuesta de valor de tu cliente en 2 minutos.", v: "doble", k: ["propuesta de valor", "presentacion del cliente", "kam"] },
  { id: "s7", e: 2, c: "Tus clientes", d: 4, g: "cap", t: "ICP y buyer persona de tu cliente", w: "KAM", vb: TL, x: "Validación: identificas 5 contactos del ICP en la base de tu cliente.", v: "doble", k: ["icp", "buyer persona"] },
  { id: "gate1", e: 2, c: "Salida a pista", d: 5, g: "gate", t: "Salida a pista", w: L, crit: ["Completaste el entrenamiento de tu cliente", "Dominas su propuesta de valor, ICP y buyer persona", "Tu líder de célula aprobó tus roleplays"], k: ["salida a pista"] },
  { id: "s17", e: 2, c: "Salida a pista", d: 5, t: "Recibir tu curva de metas y tu cliente inicial", w: L, x: "Firmas tu documento de metas.", v: "doble", k: ["curva de metas", "metas"] },

  { id: "w2", e: 3, c: "Llamada acompañada", d: 8, t: "Primera llamada en vivo acompañada, con feedback completo", w: "Tú + tu líder", vb: TL, x: "Haces el proceso completo con tu líder: preparación, llamada, registro en HubSpot y en el formulario. Recibes feedback de cada tarea de la llamada.", v: "doble", k: ["llamada acompañada", "llamada en vivo"] },
  { id: "w5", e: 3, c: "Llamada acompañada", d: 8, g: "cap", t: "Refuerzo: formulario de registro de reuniones", w: L, x: "Lo repasas antes de registrar tu primera reunión real.", k: ["formulario"] },
  { id: "cli2", e: 3, c: "Segundo cliente", d: 8, t: "Asignación de tu segundo cliente", w: "Líder + Operaciones", x: "Sigue el mismo proceso del primero.", lo: 1 },
  { id: "acc-hs2", e: 3, c: "Segundo cliente", d: 8, g: "acc", t: "Acceso a HubSpot de tu segundo cliente", w: "KAM de la cuenta", x: "Acceso a la cuenta del nuevo cliente." },
  { id: "kam2", e: 3, c: "Segundo cliente", d: 8, g: "cap", t: "Presentación de tu segundo cliente y su propuesta de valor", w: "KAM", vb: TL, x: "Validación: explicas la propuesta de valor en 2 minutos.", v: "doble", k: ["propuesta de valor", "kam"] },
  { id: "s7b", e: 3, c: "Segundo cliente", d: 9, g: "cap", t: "ICP y buyer persona de tu segundo cliente", w: "KAM", vb: TL, x: "Validación: identificas 5 contactos del ICP en su base.", v: "doble", k: ["icp", "buyer persona"] },
  { id: "gate2", e: 3, c: "Evaluación", d: 12, g: "gate", t: "Operación autónoma", w: L, crit: ["Hiciste tu primera llamada en vivo", "Registraste en HubSpot de forma guiada", "Tu líder de célula aprobó que continúes de forma autónoma"] },

  { id: "m4", e: 4, c: "Operación", d: 15, t: "Primeras llamadas acompañadas con tus dos clientes", w: "Tú + tu líder", vb: TL, x: "Una jornada acompañada por cliente.", v: "doble" },
  { id: "m5", e: 4, c: "Operación", d: 17, t: "Agendar tu primera reunión", w: "Tú", vb: TL, x: "Registrada en HubSpot y en el formulario.", v: "doble" },
  { id: "m6", e: 4, c: "Operación", d: 19, t: "Monitoreo de KPI de llamadas y gestiones", w: L, x: "Tu líder revisa tu actividad en el dashboard.", lo: 1 },
  { id: "rf-hs", e: 4, c: "Reforzamientos", d: 15, g: "cap", t: "Reforzamiento de HubSpot", w: T, x: "Repasas lo que más te cuesta en tu operación real.", v: "doble", k: ["reforzamiento hubspot", "refuerzo hubspot"] },
  { id: "rf-allo", e: 4, c: "Reforzamientos", d: 15, g: "cap", t: "Reforzamiento de Allo", w: T, x: "Repasas marcación y grabaciones con tus llamadas reales.", v: "doble", k: ["reforzamiento allo", "refuerzo allo"] },
  { id: "rf-portal", e: 4, c: "Reforzamientos", d: 15, g: "cap", t: "Reforzamiento de Portal BullsEye / Buscador de teléfonos / Registro de reuniones", w: T, x: "Repasas el portal y el registro de tus reuniones reales.", v: "doble", k: ["reforzamiento portal", "refuerzo portal"] },
  { id: "m2", e: 4, c: "Seguimiento con tu líder", d: 15, t: "1:1 semanal con tu líder", w: L, x: "Revisan tu actividad y acuerdan un compromiso.", k: ["1:1", "one on one", "1 a 1"] },
  { id: "m3", e: 4, c: "Seguimiento con tu líder", d: 15, t: "Escucha semanal de tus llamadas para feedback", w: L, x: "Durante todo el mes 1.", k: ["escucha"] },
  { id: "pit30", e: 4, c: "Evaluación", d: 30, g: "pit", t: "Pit Stop día 30", w: "Líder + JP", x: "Llega con tu autoevaluación hecha. Meta del mes 1: 10 reuniones realizadas.", k: ["pit stop"] },

  { id: "n4", e: 5, c: "Operación", d: 33, t: "Monitoreo del cumplimiento de llamadas diarias esperadas", w: L, x: "Lo ideal: 60 llamadas diarias.", lo: 1 },
  { id: "n2", e: 5, c: "Calidad de llamadas", d: 45, t: "Auditoría de call-scoring", w: T, x: "Revisan la calidad de tus llamadas.", v: "doble", k: ["call scoring", "call-scoring", "auditoria"] },
  { id: "n3", e: 5, c: "Calidad de llamadas", d: 50, t: "Clínicas de reentrenamiento", w: "Líder + Tatiana", vb: "tu líder o Tatiana", cb: ["lider", "hab"], x: "Trabajas las brechas detectadas.", v: "doble", k: ["clinica", "reentrenamiento"] },
  { id: "n5", e: 5, c: "Seguimiento con tu líder", d: 31, t: "1:1 cada dos semanas con tu líder", w: L, x: "Desde el mes 2 hasta el cierre del onboarding.", k: ["1:1", "one on one", "1 a 1"] },
  { id: "pit60", e: 5, c: "Evaluación", d: 60, g: "pit", t: "Pit Stop día 60", w: "Líder + Ingri", x: "Actitud, volumen, agendadas, realizadas y asistencia de 85% o más. Meta del mes 2: 15 reuniones realizadas.", k: ["pit stop"] },

  { id: "o5", e: 6, c: "Operación", d: 61, t: "Operación diaria autónoma", w: "Tú", vb: TL, x: "Gestionas tu cartera sin acompañamiento diario. Meta del mes 3: 20 reuniones realizadas.", v: "doble" },
  { id: "o2", e: 6, c: "Calidad de llamadas", d: 75, t: "Feedback del KAM sobre la calidad de tus reuniones", w: "KAM", x: "La mirada del cliente sobre tu trabajo.", v: "doble" },
  { id: "pit90", e: 6, c: "Evaluación", d: 90, g: "pit", t: "Pit Stop día 90", w: "Líder + Ingri + JP", x: "Meta acumulada (piso 70%), calidad de reuniones y autonomía.", k: ["pit stop"] },
  { id: "o4", e: 6, c: "Evaluación", d: 90, g: "pit", t: "Cierre del periodo de prueba", w: "Gerencia + JP", x: "Decisión de contrato indefinido.", k: ["cierre del periodo", "periodo de prueba"] },
];

// Entrenamiento de cada cliente asignado (cliente 1 en la capacitación de la
// semana 1, cliente 2 en la semana 2). Aprobado con quiz ≥ 8 de 10.
export type CatalogClient = { id: string; n: string; u: string | null };
export const QUIZ_PASS = 8;

export function acadHito(c: { id: string; n: string }, i: number): Hito {
  return i
    ? { id: "acad-" + c.id, e: 3, c: "Segundo cliente", d: 8, g: "acad", t: "Entrenamiento de cliente · " + c.n, w: "Tú, con apoyo del KAM", vb: TL, x: "Propuesta de valor, ICP, objeciones y quiz (8 de 10).", v: "doble" }
    : { id: "acad-" + c.id, e: 2, c: "Tus clientes", d: 4, g: "acad", t: "Entrenamiento de cliente · " + c.n, w: "Tú, con apoyo del KAM", vb: TL, x: "Propuesta de valor, ICP, objeciones y quiz (8 de 10).", v: "doble" };
}

// Hitos de un SDR = plan + un entrenamiento por cliente asignado.
export function hitosFor(clientes: { id: string; n: string }[]): Hito[] {
  const out: Hito[] = [];
  for (const h of HITOS) {
    out.push(h);
    if (h.id === "kam" && clientes[0]) out.push(acadHito(clientes[0], 0));
    if (h.id === "kam2") clientes.slice(1).forEach((c) => out.push(acadHito(c, 1)));
  }
  return out;
}

// ── Reglas (las mismas en la página y en el servidor) ───────────────────

export const confirmersOf = (h: Hito): Role[] => h.cb || (h.w === T ? ["hab"] : ["lider"]);
export const canConfirm = (h: Hito, role: Role) => confirmersOf(h).includes(role);
export function canMark(h: Hito, role: Role): boolean {
  if (h.rh) return role === "rrhh";
  if (h.g === "gate" || h.lo) return role === "lider";
  if (h.g === "pit") return role !== "sdr";
  return true;
}

// ── Estado guardado de un onboarding ────────────────────────────────────

export type Stamp = { at: string; by: Role; email?: string } | null;
export type OnboardingState = {
  ingreso: string | null; // AAAA-MM-DD (día 1)
  clientes: string[]; // ids de clientes de la app (máx. 2)
  hechos: Record<string, Stamp>;
  valida: Record<string, Stamp>;
  etapas: Record<string, Stamp>;
};
export type AcademyScore = { quiz: number | null; score: number | null; total: number | null; laps: number };

export function hitoStatus(s: OnboardingState, h: Hito, academias: Record<string, AcademyScore>): "ok" | "espera" | "pend" {
  if (h.alias && s.hechos[h.alias]) return "ok";
  const marked = !!s.hechos[h.id];
  if (h.g === "acad") {
    const a = academias[h.id.slice(5)];
    return marked || (a?.quiz != null && a.quiz >= QUIZ_PASS) ? "ok" : "pend";
  }
  if (!marked) return "pend";
  if (h.v === "doble" && !s.valida[h.id]) return "espera";
  return "ok";
}

// Resumen para la tabla del equipo.
export function summarize(s: OnboardingState, clientes: { id: string; n: string }[], academias: Record<string, AcademyScore>, today: Date) {
  const hs = hitosFor(clientes);
  const st = hs.map((h) => hitoStatus(s, h, academias));
  const ok = st.filter((x) => x === "ok").length;
  const espera = st.filter((x) => x === "espera").length;
  const stageOk = (i: number) => (STAGES[i].conf ? !!s.etapas[String(i)] : hs.every((h, j) => h.e !== i || st[j] === "ok"));
  const superadas = STAGES.filter((_, i) => stageOk(i)).length;
  let late = 0;
  let day: number | null = null;
  if (s.ingreso) {
    const [y, m, d] = s.ingreso.split("-").map(Number);
    const ing = new Date(y, m - 1, d);
    day = Math.round((today.getTime() - ing.getTime()) / 864e5) + 1;
    hs.forEach((h, j) => {
      const wk = h.d < 1 ? 0 : Math.floor((h.d - 1) / 7) + 1;
      const end = new Date(ing);
      end.setDate(end.getDate() + (wk < 1 ? -1 : wk * 7 - 1));
      if (st[j] !== "ok" && today > end) late++;
    });
  }
  const current = STAGES.findIndex((_, i) => !stageOk(i));
  return { ok, total: hs.length, espera, late, superadas, stages: STAGES.length, day, current: current < 0 ? STAGES.length - 1 : current };
}
