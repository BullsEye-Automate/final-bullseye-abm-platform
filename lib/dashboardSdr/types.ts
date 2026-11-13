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
  nmg: number;         // contactos gestionados
  msch: number;        // reuniones agendadas
  mheld: number;       // reuniones realizadas
  asg: string;         // fecha de asignación (YYYY-MM-DD; sin propiedad en HubSpot, la de creación)
};

export type SdrContact = {
  id: string;          // "<cuenta>:<id HubSpot>"
  co: string;          // id de la empresa (mismo formato que SdrCompany.id)
  con: string;         // nombre de la empresa
  c: string;           // cliente
  n: string;
  cargo: string;
  st: string;          // Asignación BullsEye por llamar - <cliente>
};

export type SdrIndexRow = { key: string; name: string; companies: number; contacts: number; clients: string[] };

export type SdrSlice = {
  key: string;
  name: string;
  companies: SdrCompany[];
  contacts: SdrContact[];
};

export type SdrDashboardResponse = {
  generated: string;
  today: string;
  me: { key: string | null; name: string | null };         // SDR de la sesión (por correo)
  index: SdrIndexRow[];
  sources: { client: string; syncedAt: string | null }[];  // informes de Pulso ABM leídos
  missing: string[];                                       // clientes activos sin informe de Pulso
  sdr: SdrSlice | null;
};
