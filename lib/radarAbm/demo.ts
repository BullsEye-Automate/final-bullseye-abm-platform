import type { RadarClientData, RadarDataset } from "./types";

// Datos demo del Radar ABM: la constante RAW del prototipo
// Radar_ABM_BullsEye_BETA.html (20 clientes con empresas, contactos y cifras
// FICTICIAS, con la estructura de HubSpot). Sirven para validar métricas y
// formato antes de conectar HubSpot. Solo los ve el equipo interno y siempre
// con el badge "Datos demo"; el portal de clientes nunca los muestra.

type Raw = { generated: string; period: [string, string]; clients: RadarClientData[] };
// require (no import): el JSON pesa 1,7 MB y con import TypeScript infiere
// su tipo completo, lo que dispara la memoria del typecheck.
const raw = require("./demo/raw.json") as Raw;

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function demoClientNames(): string[] {
  return raw.clients.map((c) => c.name);
}

// Set demo del cliente con el mismo nombre; si no hay, el primero.
export function demoDataset(name?: string | null): RadarDataset {
  const client = (name && raw.clients.find((c) => norm(c.name) === norm(name))) || raw.clients[0];
  return { client, generated: raw.generated, period: raw.period, source: "demo", syncedAt: null };
}
