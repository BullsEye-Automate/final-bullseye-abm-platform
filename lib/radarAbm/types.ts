// Radar ABM — forma de los datos de un cliente.
// Es la misma estructura que la constante RAW del prototipo
// Radar_ABM_BullsEye_BETA.html (claves cortas para que el JSON pese poco):
// cliente → companies, contacts, meetings, deals. La genera el sync de
// HubSpot (lib/radarAbm/server/sync.ts) o el set de datos demo.

export type RadarCompany = {
  id: number | string;
  n: string;                 // nombre
  ind?: string | null;       // industria
  pais: string;
  size: string;              // Pyme / Mid-market / Enterprise
  icp: string;               // A / B / C ("s/i" sin tier)
  sdr: string;
  asg: string;               // fecha de asignación (YYYY-MM-DD)
  st: string;                // Status de la asignación - SDR
  wl?: string;               // valor de "Wish List - <cliente>" (sin él: fuera de la wishlist)
  next?: string;             // próximo seguimiento
  nct: number;               // contactos
  nmg: number;               // contactos gestionados
  neff: number;              // contactos efectivos
  areas: string[];           // áreas con contacto efectivo
  msch: number;              // reuniones agendadas
  mheld: number;             // reuniones realizadas
  fu: boolean;               // tiene seguimiento
  opp: boolean;              // tiene oportunidad
  depth: string;             // Profunda / Multi-thread / Single-thread / Sin contacto efectivo
  prio: string;              // Alta / Media / Baja / ""
  why: string;               // motivo de la prioridad
};

export type RadarContact = {
  id: number | string;
  co: number | string;       // empresa
  n: string;
  cargo?: string;
  area: string;
  sen: string;
  sdr: string;
  st: string;                // Asignación BullsEye por Llamar
  att?: number;              // intentos (= llamadas)
  calls?: number;
  wa?: number;
  li?: number;
  em?: number;
  last?: string;             // última actividad
  next?: string;             // próxima actividad
  conv?: number;             // llamadas conectadas ("Resultado de la llamada" = Conectad…)
  fu?: "interes" | "retomar" | "conv";
  sig?: string;              // señal de interés
  obj?: string;              // objeción
  note?: string;
  refBy?: number | string;   // contacto que lo refirió
  nuevo?: boolean;           // contacto nuevo en empresa ya nutrida
  ps: string;                // próximo paso (texto automático)
};

export type RadarMeeting = {
  id: number | string;
  ct: number | string;
  ctn?: string;              // nombre del contacto en la planilla de reuniones
  co: number | string;
  sdr: string;
  agendada: string;
  fecha: string;
  st: string;                // Realizada / Pendiente / Reprogramada / No-show / Cancelada
  icpfit?: boolean;
  okct?: boolean;
  need?: string;
  fb?: string;
  res?: string;              // Oportunidad / Seguimiento / Sin avance / Descartada
  next?: boolean;
  reprog?: boolean;
  deal?: boolean;
};

export type RadarDeal = {
  co: number | string;
  ct?: number | string;
  stage: string;             // Calificación / Propuesta enviada / Negociación / Ganado / Perdido
  amount: number;
  created: string;
};

// Actividad asociada a la cuenta (profundidad por canal). Solo en datos
// sincronizados desde HubSpot; los datos demo traen solo los conteos por
// contacto (calls / wa / li / em).
export type ActivityKind = "call" | "wa" | "li" | "em";
export type RadarActivity = {
  id: string;
  k: ActivityKind;
  co: number | string;       // empresa
  ct?: number | string;      // contacto (sin él: asociada solo a la empresa)
  d?: string;                // fecha (YYYY-MM-DD)
  in?: 1;                    // correo entrante (respuesta)
  conn?: 1;                  // llamada conectada
};

export type RadarClientData = {
  name: string;
  universe: number;
  sdrs: string[];
  pipeline: boolean;         // el cliente registra negocios
  deep: boolean;             // cartera acotada de cuentas estratégicas
  companies: RadarCompany[];
  contacts: RadarContact[];
  meetings: RadarMeeting[];
  deals: RadarDeal[];
  activities?: RadarActivity[];
};

export type RadarSource = "demo" | "hubspot";

// Lo que reciben las pantallas: datos + metadatos de origen
export type RadarDataset = {
  client: RadarClientData;
  generated: string;         // fecha de corte (YYYY-MM-DD)
  period: [string, string];  // inicio y fin del período
  range?: { from: string; to: string }; // rango elegido en el selector de fechas (lo pone filterDataset)
  trendBase?: { period: [string, string]; agendadas: string[] }; // con rango: reuniones del período completo para la tendencia por meses
  source: RadarSource;
  syncedAt?: string | null;  // última sincronización con HubSpot
  warnings?: string[];
  mapping?: { label: string; property: string | null }[]; // propiedades usadas (anexo A1)
};

// Parámetros editables (Configuración del Radar ABM)
export type HealthComponentConfig = { weight: number; target: number };

export type RadarConfig = {
  health: Record<string, HealthComponentConfig>;
  sizeTiers: { pymeMax: number; midMax: number };       // empleados
  titleRules: { kw: string; area?: string; sen?: string }[];
  properties: Record<string, string>;                   // clave → nombre interno HubSpot
  periodMonths: number;
  definitions: { companies: Record<string, string>; contacts: Record<string, string> }; // status → definición
  contactAliases: Record<string, string>;               // etiqueta de contacto → status del diccionario (o "Excluir del informe")
  companyAliases: Record<string, string>;               // etiqueta de empresa → status del diccionario (o "Excluir del informe")
};
