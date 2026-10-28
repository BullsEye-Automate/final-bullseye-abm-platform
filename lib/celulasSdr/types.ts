// Contrato de datos del módulo "Células SDR" (app/analisis/celulas-sdr).
// Las rutas de /api/celulas-sdr/* devuelven estos tipos "planos" (sin
// datos de contacto de prospectos: ni teléfonos, ni correos, ni nombres) y
// todo el cálculo de KPIs, ritmos y alertas se hace en el navegador
// (lib/celulasSdr/engine.ts), igual que el prototipo HTML, para que los
// filtros y cambios de período respondan al instante sin volver a consultar
// Allo / HubSpot.

// Grupo al que pertenece cada SDR en los filtros y en la comparación de
// células:
// - "cell": integrante de la célula de un líder (pestaña "Maestra IA", col. O:P)
// - "leader": el propio líder de célula. Tiene meta propia, pero por
//   definición de BullsEye su meta y sus reuniones NO suman a su célula.
// - "none": responsable con meta / reuniones / llamadas que no está en
//   ninguna célula (ej. SDR que ya salió del equipo).
export type SdrGroup = "cell" | "leader" | "none";

export type CellLeader = {
  key: string;          // clave canónica del líder (resolveSdrKey)
  name: string;         // nombre completo
  short: string;        // nombre de pila, para tags
  color: string;
};

export type Sdr = {
  key: string;          // clave canónica (resolveSdrKey) — une Asignación, reuniones, Allo y HubSpot
  name: string;         // nombre a mostrar
  short: string;
  initials: string;
  group: SdrGroup;
  leaderKey: string | null; // célula a la que pertenece (solo group === "cell")
  active: boolean | null;   // "Status Responsable" de la Maestra (null = no figura)
  color: string;
};

export type Client = {
  id: string;           // id de Supabase, o "name:<nombre normalizado>" si no existe en la tabla clients
  name: string;
};

// Meta mensual de reuniones realizadas por SDR × cliente (pestaña
// "Asignación"). La meta del cliente es la suma de las metas de sus SDR.
export type Goal = {
  month: string;        // YYYY-MM
  sdr: string;          // Sdr.key
  client: string;       // Client.id
  goal: number;
};

export type MeetingStatus = "held" | "noshow" | "resch" | "pending";

export type Meeting = {
  sdr: string;              // Sdr.key (de "Responsable de la reunión")
  client: string | null;    // Client.id
  country: string | null;   // país canónico (columna País de la planilla)
  sd: string | null;        // fecha de agendamiento YYYY-MM-DD
  md: string | null;        // fecha de la reunión YYYY-MM-DD
  st: MeetingStatus;
  opp: string;              // valor normalizado de "Propuesta/Oportunidad" ("" si vacío)
  origin: string;
  company: string;          // empresa prospecto (sin datos de contacto)
};

// Llamadas salientes de Allo agregadas por día × SDR × cliente × país.
export type CallDay = {
  d: string;                // YYYY-MM-DD (horario de Chile)
  s: string;                // Sdr.key (usuario de Allo)
  c: string | null;         // Client.id (número de Allo → client_allo_numbers)
  k: string;                // país (prefijo telefónico del número de Allo)
  calls: number;
  contacted: number;        // etapa "Conversación" del embudo de Allo
};

// Una llamada con "Score de Desempeño SDR" (summary de Allo, ver
// lib/callScoreCard.ts).
export type CallEval = {
  id: string;
  d: string;
  s: string;
  c: string | null;
  k: string;
  dur: number;              // segundos
  score: number;            // 0-100
  crit: (number | null)[];  // ítems del desglose, normalizados a /5 (orden de SCORE_CARD_CATEGORIES)
  nivel: string | null;
  strength: string | null;
  improve: string | null;
};

// Actividades de HubSpot (Correo / WhatsApp / LinkedIn) por día × SDR.
// Cada actividad se cuenta en el HubSpot del cliente que se trabaja (sin
// duplicados, confirmado con BullsEye): las del HubSpot propio de un cliente
// (client_configs.hubspot_access_token) traen su cliente en `c`; las del
// HubSpot de BullsEye vienen con c = null (ahí no se sabe a qué cliente
// pertenecen).
export type ChannelDay = {
  d: string;
  s: string;
  c: string | null;         // Client.id (HubSpot propio del cliente) o null (HubSpot de BullsEye)
  email: number;
  wa: number;
  li: number;
};

export type DataWarning = { source: string; message: string };

export type BaseResponse = {
  months: string[];         // meses cargados (YYYY-MM), del más antiguo al más nuevo
  today: string;            // YYYY-MM-DD en Chile
  leaders: CellLeader[];
  sdrs: Sdr[];
  clients: Client[];
  goals: Goal[];
  meetings: Meeting[];
  oppValues: string[];      // valores distintos de Propuesta/Oportunidad (para Configurar)
  incomplete: { pastPending: number; invalidDates: number };
  warnings: DataWarning[];
};

export type AlloMonthResponse = {
  month: string;
  calls: CallDay[];
  evals: CallEval[];
  sdrNames: Record<string, string>; // Sdr.key → nombre en Allo (para sumar callers fuera del roster)
  connectedSource: "allo" | "fallback";
  cachedAt: string;
  warnings: DataWarning[];
};

export type HubspotMonthResponse = {
  month: string;
  channels: ChannelDay[];
  connectedClients: string[]; // Client.id con HubSpot propio conectado
  sdrNames: Record<string, string>;
  cachedAt: string;
  warnings: DataWarning[];
};

// Parámetros de "Configurar". Se guardan globales (tabla sdr_cells_config):
// todos los usuarios ven la misma información.
export type CellsConfig = {
  green: number;          // umbral verde del semáforo (0-1)
  yellow: number;         // umbral amarillo (0-1)
  callGoal: number;       // meta diaria de llamadas por SDR
  actGoal: number;        // meta diaria de actividades por SDR
  noshowMax: number;
  connectMin: number;
  connectTarget: number;
  attendTarget: number;
  oppTarget: number;
  cap: number;            // tope de sobrecumplimiento por cliente
  qTarget: number;        // meta de puntaje de llamadas (pts)
  qGood: number;          // desde aquí la llamada es "Buena" (verde)
  qReg: number;           // desde aquí "Regular" (amarillo); bajo esto "Deficiente"
  goalBase: "mes" | "fecha";
  oppValues: string[];    // valores normalizados de Propuesta/Oportunidad que cuentan como oportunidad
  clientWeights: Record<string, number>; // Client.id → peso (%) — vacío = proporcional a la meta
};

// Colores del score de llamadas: los mismos de la app (lib/callScoreCard.ts
// scoreColor100 — verde ≥ 80, amarillo ≥ 60, rojo < 60).
export const DEFAULT_CONFIG: CellsConfig = {
  green: 0.9,
  yellow: 0.7,
  callGoal: 60,
  actGoal: 110,
  noshowMax: 0.2,
  connectMin: 0.15,
  connectTarget: 0.2,
  attendTarget: 0.85,
  oppTarget: 0.35,
  cap: 1.2,
  qTarget: 80,
  qGood: 80,
  qReg: 60,
  goalBase: "mes",
  oppValues: ["si"],
  clientWeights: {},
};

// Evolutivo mensual de reuniones desde enero (vista "Evolutivo mensual"):
// conteos ya agregados por mes × SDR × cliente × país, para no bajar todas
// las reuniones del año. Agendadas por fecha de agendamiento; realizadas por
// fecha de la reunión.
export type MonthlyMeetingRow = {
  m: string;                // YYYY-MM
  s: string;                // Sdr.key
  c: string | null;         // Client.id
  k: string | null;         // país canónico
  sched: number;            // agendadas (fecha de agendamiento en el mes)
  held: number;             // realizadas (fecha de la reunión en el mes)
};

export type MonthlyMeetingsResponse = {
  year: number;
  months: string[];         // ene → mes actual
  today: string;
  rows: MonthlyMeetingRow[];
  sdrNames: Record<string, string>;
};
