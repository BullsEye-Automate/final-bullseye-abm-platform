import { supabaseAdmin } from "./supabase";
import { getSheetRows } from "./googleSheets";

function parseDate(str: string): string | null {
  if (!str) return null;
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return null;
  if (parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return str;
}

function normalizeRealizado(val: string): string {
  const v = val.trim().toLowerCase();
  if (v === "si" || v === "sí" || v === "yes") return "Si";
  if (v === "no")                               return "No";
  if (v === "reagendar" || v === "re-agendar") return "Reagendar";
  return "Pendiente";
}

export async function runMeetingsSync(): Promise<{
  ok: boolean;
  synced?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) {
    return { ok: false, error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" };
  }

  let rows: Record<string, string>[];
  try {
    rows = await getSheetRows(spreadsheetId, "API Reuniones - IA");
  } catch (err: any) {
    return { ok: false, error: `Error leyendo Google Sheets: ${err.message}` };
  }

  if (rows.length === 0) {
    return { ok: true, synced: 0, message: "Hoja vacía" } as any;
  }

  const supabase = supabaseAdmin();
  const { data: clients } = await supabase.from("clients").select("id, name");
  const clientByName = new Map<string, string>();
  (clients ?? []).forEach((c) => clientByName.set(c.name.toLowerCase().trim(), c.id));

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) { skipped++; continue; }

    let clientId: string | null = row["ID Cliente"]?.trim() || null;
    if (!clientId) {
      const clientNombre = row["Cliente"]?.trim().toLowerCase();
      if (clientNombre) clientId = clientByName.get(clientNombre) ?? null;
    }

    const sheetRowKey = `${spreadsheetId}::${row.__rowIndex}`;

    const record = {
      sheet_row_key:         sheetRowKey,
      client_id:             clientId,
      empresa,
      contacto_nombre:       row["Contacto"]                 || null,
      contacto_cargo:        row["Cargo"]                    || null,
      fecha_reunion:         parseDate(row["Fecha de la reunión"]),
      fecha_agendamiento:    parseDate(row["Fecha de agendamiento"]),
      hora:                  row["Hora"]                     || null,
      pais:                  row["País"]                     || null,
      realizado:             normalizeRealizado(row["Realizado"] ?? ""),
      origen:                row["Origen"]                   || null,
      responsable:           row["Responsable de la reunión"] || null,
      propuesta_oportunidad: row["Propuesta/Oportunidad"]    || null,
      sales_manager:         row["Sales Manager"]            || null,
      telefono:              row["Teléfono"]                 || null,
      correo:                row["Correo"]                   || null,
      industria:             row["Industria"]                || null,
      notas:                 row["Comentario de la reunión"] || null,
      hora_formulario:       row["Hora envío formulario"]    || null,
    };

    const { error } = await supabase
      .from("meetings")
      .upsert(record, { onConflict: "sheet_row_key" });

    if (error) {
      errors.push(`Fila ${row.__rowIndex} (${empresa}): ${error.message}`);
    } else {
      synced++;
    }
  }

  return { ok: true, synced, skipped, errors: errors.length > 0 ? errors : undefined };
}
