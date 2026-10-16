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
