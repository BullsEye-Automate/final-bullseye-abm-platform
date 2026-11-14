// Dashboard SDR (/sdr/dashboard): tipos compartidos entre servidor y navegador.
// Claves cortas para que la respuesta pese poco (un SDR puede tener miles de
// contactos asignados entre todos sus clientes).

export type SdrCompany = {
  id: string;          // único en todo el dashboard: "<cuenta>:<id HubSpot>"
  c: string;           // cliente (cuenta de Pulso ABM)
  n: string;           // nombre de la empresa
  st: string;          // Status de la asignación - <cliente>
  pais: string;
  ind: string | null;  // industria
  nct: number;         // contactos asociados (universo del cliente)
  nmg: number;         // contactos gestionados (status distinto de por gestionar)
  msch: number;        // reuniones agendadas (histórico del informe)
  mheld: number;       // reuniones realizadas
  asg: string;         // fecha de asignación (YYYY-MM-DD; sin propiedad en HubSpot, la de creación)
  next?: string;       // fecha de próximo seguimiento
  tr?: 1;              // tiene al menos un llamado (empresa o sus contactos)
};

export type SdrContact = {
  id: string;          // "<cuenta>:<id HubSpot>"
  co: string;          // id de la empresa (mismo formato que SdrCompany.id)
  con: string;         // nombre de la empresa
  c: string;           // cliente
  n: string;
  cargo: string;
  st: string;          // Asignación BullsEye por llamar - <cliente>
  sen?: string;        // seniority (derivado del cargo)
  area?: string;       // área (derivada del cargo)
  next?: string;       // próxima actividad (HubSpot)
  tr?: 1;              // tiene al menos un llamado
  ph?: 0 | 1;          // tiene teléfono (sin el campo: el informe aún no trae el dato)
  ml?: 0 | 1;          // tiene correo
  lk?: 0 | 1;          // tiene LinkedIn
};

// Reunión de la planilla (API Reuniones) cuyo responsable es el SDR
export type SdrMeeting = {
  c: string;           // cliente
  co: string;          // id de la empresa ("" si no calza con una empresa del universo)
  con: string;         // empresa
  ctn: string;         // contacto
  sen?: string;        // seniority del contacto (si calza con un contacto)
  area?: string;
  ag: string;          // fecha de agendamiento (YYYY-MM-DD)
  f: string;           // fecha de la reunión
  st: string;          // Realizada / Pendiente / Reprogramada / No-show
};

export type SdrSlice = {
  key: string;
  name: string;
  companies: SdrCompany[];
  contacts: SdrContact[];
  meetings: SdrMeeting[];
  goals: Record<string, number>;   // meta de reuniones del mes por cliente (Asignación)
  ctData: Record<string, boolean>; // cliente → el informe trae teléfono / correo / LinkedIn
};

// Resumen por SDR para la vista de la líder (se calcula en el servidor)
export type SdrSummary = {
  cos: number; unw: number; est: number; seg: number; sta: number; reu: number; hs: number;
  ag: number; re: number; ns: number; pe: number; withMtg: number;
  goal: number; goalDone: number;   // meta del mes (suma de sus clientes) y realizadas de esos clientes
  oldest: { n: string; c: string; d: number }[];
  perClient: { c: string; cos: number; none: number; stock: number; telN: number; telD: number }[];
};

export type SdrIndexRow = {
  key: string; name: string; companies: number; contacts: number; clients: string[];
  cell: string | null;             // líder de su célula (Maestra)
  summary: SdrSummary;
};

export type SdrDashboardResponse = {
  generated: string;
  today: string;
  me: { key: string | null; name: string | null };         // SDR de la sesión (por correo)
  index: SdrIndexRow[];
  cells: string[];                                         // líderes de célula
  sources: { client: string; syncedAt: string | null }[];  // informes de Pulso ABM leídos
  missing: string[];                                       // clientes activos sin informe de Pulso
  notActive?: string[];                                    // clientes con informe de Pulso pero no activos en la Maestra
  // Valores de SDR en HubSpot que no quedan en una SDR activa (diagnóstico)
  unmatched?: { client: string; raw: string; name: string; why: string; companies: number; contacts: number }[];
  sdr: SdrSlice | null;
};
