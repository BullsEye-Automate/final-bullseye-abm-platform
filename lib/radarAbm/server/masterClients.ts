import { getSheetValues } from "@/lib/googleSheets";

// Pulso ABM — validación de cliente activo contra la Maestra.
// Planilla "Metas equipo BullsEye / reuniones / oportunidades"
// (GOOGLE_SHEETS_MEETINGS_ID), pestaña "Maestra IA", columnas A–C:
// Cliente | ID Cliente | Status Cliente. Solo se sincroniza y se muestra en
// el portal el Radar de clientes con Status Cliente = Activo.

export type MasterClient = { name: string; id: string; status: string; active: boolean };
export type MasterCheck =
  | { active: true; row: MasterClient }
  | { active: false; row: MasterClient | null; reason: string };

const TAB = "Maestra IA";
const TTL_MS = 10 * 60_000;
let cache: { at: number; rows: MasterClient[] } | null = null;

const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const compact = (s: string) => norm(s).replace(/[^a-z0-9]/g, "");

export async function readMasterClients(force = false): Promise<MasterClient[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado: no se puede validar en la Maestra si el cliente está activo.");
  const values = await getSheetValues(spreadsheetId, `'${TAB}'!A1:C500`);
  // Encabezado ubicado por nombre (Cliente / ID Cliente / Status Cliente)
  const hIdx = values.findIndex((r) => r.some((c) => norm(c) === "status cliente"));
  if (hIdx < 0) throw new Error(`No se encontró la columna "Status Cliente" en la pestaña "${TAB}" de la Maestra.`);
  const h = values[hIdx].map(norm);
  const cName = h.indexOf("cliente"), cId = h.indexOf("id cliente"), cStatus = h.indexOf("status cliente");
  const rows: MasterClient[] = [];
  for (const r of values.slice(hIdx + 1)) {
    const name = (r[cName] ?? "").replace(/​/g, "").trim();
    if (!name) continue;
    const status = (r[cStatus] ?? "").trim();
    rows.push({ name, id: cId >= 0 ? (r[cId] ?? "").trim() : "", status, active: norm(status) === "activo" });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

// Fila de la Maestra de un cliente de la app: por ID Cliente (id o slug de
// la app) y, si no, por nombre (sin tildes, mayúsculas ni espacios)
export function findMasterRow(rows: MasterClient[], client: { id: string; name: string; slug?: string | null }): MasterClient | null {
  const ids = [client.id, client.slug].filter(Boolean).map((x) => norm(String(x)));
  return (
    rows.find((r) => r.id && ids.includes(norm(r.id))) ??
    rows.find((r) => norm(r.name) === norm(client.name)) ??
    rows.find((r) => compact(r.name) === compact(client.name)) ??
    null
  );
}

export async function checkClientActive(client: { id: string; name: string; slug?: string | null }): Promise<MasterCheck> {
  const row = findMasterRow(await readMasterClients(), client);
  if (!row) return { active: false, row: null, reason: `"${client.name}" no figura en la Maestra (pestaña "${TAB}", columna Cliente).` };
  if (!row.active) return { active: false, row, reason: `"${row.name}" figura como "${row.status || "sin status"}" en la Maestra: Pulso ABM solo se trae para clientes activos.` };
  return { active: true, row };
}

// Portal: el informe solo se muestra a clientes activos. Si la Maestra no se
// puede leer, no se muestra (se registra el error).
export async function isPortalClientActive(clientId: string, clientName: string): Promise<boolean> {
  try {
    return (await checkClientActive({ id: clientId, name: clientName })).active;
  } catch (e) {
    console.error("Pulso ABM: no se pudo validar el cliente en la Maestra:", e);
    return false;
  }
}

// Para las pantallas internas: estado en la Maestra sin lanzar errores
export async function masterStatusFor(client: { id: string; name: string; slug?: string | null }): Promise<{ active: boolean; text: string }> {
  try {
    const r = await checkClientActive(client);
    return r.active ? { active: true, text: `Activo en la Maestra (${r.row.name})` } : { active: false, text: r.reason };
  } catch (e) {
    return { active: false, text: `No se pudo leer la Maestra: ${(e as Error).message}` };
  }
}
