import { supabaseAdmin } from "./supabase";
import { getSheetRows } from "./googleSheets";

// Normaliza nombres de cliente para matching: minúsculas, sin tildes, sin espacios extras
function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
    .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ü/g, "u").replace(/ñ/g, "n")
    .replace(/\s+/g, " ");
}

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
  const { data: clients } = await supabase.from("clients").select("id, name, slug");
  const clientByName = new Map<string, string>();
  (clients ?? []).forEach((c) => {
    // Indexar por nombre normalizado y por slug para máxima tolerancia de variaciones
    clientByName.set(normalizeName(c.name), c.id);
    if (c.slug) clientByName.set(normalizeName(c.slug), c.id);
  });

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) { skipped++; continue; }

    let clientId: string | null = row["ID Cliente"]?.trim() || null;
    if (!clientId) {
      const clientNombre = row["Cliente"]?.trim();
      if (clientNombre) {
        const normalized = normalizeName(clientNombre);
        clientId = clientByName.get(normalized) ?? null;
        // Fallback: buscar coincidencia parcial (ej: "Nisum Peru" matchea "Nisum Perú SA")
        if (!clientId) {
          for (const [key, id] of clientByName.entries()) {
            if (key.startsWith(normalized) || normalized.startsWith(key)) {
              clientId = id;
              break;
            }
          }
        }
      }
    }

    const sheetRowKey = `${spreadsheetId}::${row.__rowIndex}`;

    // Verificar si la reunión ya existe en BD y tiene feedback — en ese caso NO cambiar client_id
    // para evitar que el sync mueva reuniones con feedback a otro cliente.
    const { data: existing } = await supabase
      .from("meetings")
      .select("id, client_id, feedback_status")
      .eq("sheet_row_key", sheetRowKey)
      .maybeSingle();

    const safeClientId = (existing?.feedback_status === "con_feedback" && existing?.client_id)
      ? existing.client_id   // mantener el client_id actual si ya tiene feedback
      : clientId;

    const record = {
      sheet_row_key:         sheetRowKey,
      client_id:             safeClientId,
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
