import { getSheetValues } from "@/lib/googleSheets";

// Respuestas Lemlist → SDR: directorio de personas desde la Maestra.
// Pestaña "Maestra IA" (GOOGLE_SHEETS_MEETINGS_ID), columnas "Responsable |
// Status Responsable | Correo" (encabezado ubicado por nombre). Es una lista
// de personas independiente de la lista de clientes (columnas A–C).
//
// En HubSpot las propiedades "SDR - <cliente>" guardan el nombre de pila
// ("Vanessa", "Ivo", "Nico"); en la Maestra está el nombre completo. El cruce
// es: equivalencia explícita (SDR_ALIASES) → nombre completo → primer
// nombre, si calza con una sola persona.

export type MasterPerson = { name: string; active: boolean; email: string | null };
export type SdrResolution =
  | { ok: true; person: MasterPerson }
  | { ok: false; reason: string; person?: MasterPerson };

const TAB = "Maestra IA";
const TTL_MS = 10 * 60_000;
let cache: { at: number; people: MasterPerson[] } | null = null;

export const normName = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Valores de HubSpot que no calzan solos con el nombre de la Maestra
// (confirmados con BullsEye, nov-2026). Clave = valor normalizado.
export const SDR_ALIASES: Record<string, string> = {
  "nico": "Nicolle Nazar",
  "nicolle": "Nicolle Nazar",
  "nicolle n": "Nicolle Nazar",
  "angeles": "María de los Ángeles Pérez",
  "vanesa": "Vanessa Abarzua",
  "consuelo c": "Consuelo Contador",
};

export async function readMasterPeople(force = false): Promise<MasterPerson[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.people;
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado: no se puede leer la Maestra.");
  const values = await getSheetValues(spreadsheetId, `'${TAB}'!A1:Z500`);
  const hIdx = values.findIndex((r) => r.some((c) => normName(c) === "status responsable"));
  if (hIdx < 0) throw new Error(`No se encontró la columna "Status Responsable" en la pestaña "${TAB}".`);
  const h = values[hIdx].map(normName);
  const cName = h.indexOf("responsable");
  const cStatus = h.indexOf("status responsable");
  const cMail = h.findIndex((x) => x === "correo" || x === "email" || x === "correo responsable");
  const people: MasterPerson[] = [];
  for (const r of values.slice(hIdx + 1)) {
    const name = (r[cName] ?? "").trim();
    if (!name) continue;
    const email = cMail >= 0 ? (r[cMail] ?? "").trim().toLowerCase() : "";
    people.push({ name, active: normName(r[cStatus] ?? "") === "activo", email: /@/.test(email) ? email : null });
  }
  cache = { at: Date.now(), people };
  return people;
}

// Valor de la propiedad SDR en HubSpot → persona de la Maestra
export function resolveSdr(people: MasterPerson[], value: string | null | undefined): SdrResolution {
  const v = normName(value ?? "");
  if (!v) return { ok: false, reason: "La empresa y el contacto no tienen SDR asignado en HubSpot." };
  const alias = SDR_ALIASES[v];
  const target = alias ? normName(alias) : v;
  let matches = people.filter((p) => normName(p.name) === target);
  if (!matches.length) matches = people.filter((p) => normName(p.name).split(" ")[0] === target.split(" ")[0] && target.split(" ").length === 1);
  // Si hay varias, se prefiere la activa (una sola)
  if (matches.length > 1) {
    const act = matches.filter((p) => p.active);
    if (act.length === 1) matches = act;
  }
  if (!matches.length) return { ok: false, reason: `El SDR "${value}" de HubSpot no figura en la Maestra.` };
  if (matches.length > 1) return { ok: false, reason: `El SDR "${value}" de HubSpot calza con varias personas de la Maestra (${matches.map((m) => m.name).join(", ")}).` };
  const person = matches[0];
  if (!person.active) return { ok: false, reason: `El SDR asignado (${person.name}) está inactivo en la Maestra.`, person };
  if (!person.email) return { ok: false, reason: `${person.name} no tiene correo en la Maestra.`, person };
  return { ok: true, person };
}

// KAM de cada cliente (confirmado con BullsEye, nov-2026; la Maestra aún no
// tiene columna de KAM). Clave = inicio del nombre del cliente normalizado.
const KAM_BY_CLIENT: [string, string][] = [
  ["nisum", "rarredondo@bullseye-abm.com"],
  ["ki", "rarredondo@bullseye-abm.com"],
];
export const DEFAULT_KAM = "ihincapie@bullseye-abm.com";

export function kamFor(clientName: string): string {
  const n = normName(clientName);
  const hit = KAM_BY_CLIENT.find(([k]) => n === k || n.startsWith(k + " "));
  return hit ? hit[1] : DEFAULT_KAM;
}
