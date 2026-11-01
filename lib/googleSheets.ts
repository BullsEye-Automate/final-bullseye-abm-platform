import { google } from "googleapis";

export async function getSheetRows(
  spreadsheetId: string,
  sheetName: string
): Promise<Record<string, string>[]> {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const credentials = JSON.parse(credentialsJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = (rows[0] as string[]).map((h) => h.trim());
  return rows.slice(1).map((row, rowIndex) => {
    const obj: Record<string, string> = { __rowIndex: String(rowIndex + 2) };
    headers.forEach((h, i) => {
      obj[h] = ((row as string[])[i] ?? "").trim();
    });
    return obj;
  });
}

// Lectura "cruda" (matriz de celdas tal cual, sin asumir que la primera fila
// es un encabezado). La necesitan pestañas con estructura de matriz como
// "Asignación" (un bloque por mes, con su propio encabezado de SDR) o
// columnas sueltas de la pestaña "Maestra IA" (líderes de célula en O:P).
export async function getSheetValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentialsJson),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return ((response.data.values ?? []) as unknown[][]).map((row) => row.map((c) => String(c ?? "").trim()));
}

// Índice de columna (0 = A) → letra de columna de Sheets (A, B, …, Z, AA…).
function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export type CellWriteResult =
  | { ok: true; row: number; previous: string }
  | { ok: false; reason: "not_found" | "column_missing" | "conflict"; current?: string; row?: number };

// Escribe UNA celda de la fila cuya columna `keyHeader` vale `keyValue`
// (ej. "ID Reunión" = <id>), en la columna `targetHeader`. Antes de escribir
// relee la fila: si `expected(actual)` es falso no escribe y devuelve
// "conflict" con el valor actual (alguien la cambió en la planilla). Es la
// única escritura de la app sobre la planilla de metas; la cuenta de
// servicio necesita permiso de Editor en ese archivo.
export async function updateSheetCellByKey(opts: {
  spreadsheetId: string;
  sheetName: string;
  keyHeader: string;
  keyValue: string;
  targetHeader: string;
  value: string;
  expected?: (current: string) => boolean;
}): Promise<CellWriteResult> {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentialsJson),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: opts.spreadsheetId, range: opts.sheetName });
  const rows = (res.data.values ?? []) as string[][];
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  const keyCol = headers.indexOf(opts.keyHeader);
  const targetCol = headers.indexOf(opts.targetHeader);
  if (keyCol < 0 || targetCol < 0) return { ok: false, reason: "column_missing" };
  const idx = rows.findIndex((r, i) => i > 0 && String(r[keyCol] ?? "").trim() === opts.keyValue);
  if (idx < 0) return { ok: false, reason: "not_found" };
  const current = String(rows[idx][targetCol] ?? "").trim();
  const row = idx + 1; // filas de Sheets parten en 1
  if (opts.expected && !opts.expected(current)) return { ok: false, reason: "conflict", current, row };
  await sheets.spreadsheets.values.update({
    spreadsheetId: opts.spreadsheetId,
    range: `'${opts.sheetName.replace(/'/g, "''")}'!${colLetter(targetCol)}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[opts.value]] },
  });
  return { ok: true, row, previous: current };
}
