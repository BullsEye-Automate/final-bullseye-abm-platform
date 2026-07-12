import { supabaseAdmin } from "./supabase";
import { getSheetRows } from "./googleSheets";

export function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
    .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ü/g, "u").replace(/ñ/g, "n")
    .replace(/\s+/g, " ");
}

export function parseDate(str: string): string | null {
  if (!str) return null;
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return null;
  if (parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return str;
}

// Clave estable de identidad de una reunión, usada como respaldo cuando la
// fila de la planilla todavía no tiene "ID Reunión" (columna agregada al
// Apps Script — ver supabase/meetings_stable_key_migration.sql). No depende
// de la posición de la fila, sino del contenido.
export function buildMatchKey(empresa: string, contacto: string, fechaReunion: string | null): string {
  return `${normalizeName(empresa)}|${normalizeName(contacto)}|${fechaReunion ?? ""}`;
}

function normalizeRealizado(val: string): string {
  const v = val.trim().toLowerCase();
  if (v === "si" || v === "sí" || v === "yes") return "Si";
  if (v === "no")                               return "No";
  if (v === "reagendar" || v === "re-agendar") return "Reagendar";
  return "Pendiente";
}

export type SyncPreviewItem = {
  empresa: string;
  rowIndex: number;
  reason: "sin_cliente" | "feedback_protegido";
  clienteActual?: string;
  clienteNuevo?: string | null;
  meetingId?: string;
  newClientId?: string | null;
};

export type SyncResult = {
  ok: boolean;
  synced?: number;
  skipped?: number;
  skipped_sin_cliente?: number;
  feedbacks_protegidos?: number;
  errors?: string[];
  error?: string;
  preview?: SyncPreviewItem[];  // solo cuando preview=true
};

async function resolveClientId(
  row: Record<string, string>,
  clientByName: Map<string, string>
): Promise<string | null> {
  const directId = row["ID Cliente"]?.trim() || null;
  if (directId) return directId;

  const clientNombre = row["Cliente"]?.trim();
  if (!clientNombre) return null;

  const normalized = normalizeName(clientNombre);
  const byExact = clientByName.get(normalized);
  if (byExact) return byExact;

  // Coincidencia parcial solo si es unívoca (evita asignar mal)
  const partialMatches: string[] = [];
  for (const [key, id] of clientByName.entries()) {
    if (key.startsWith(normalized) || normalized.startsWith(key)) {
      partialMatches.push(id);
    }
  }
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

// preview=true: no escribe nada, solo devuelve lo que cambia / se saltea
export async function runMeetingsSync(preview = false): Promise<SyncResult> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) return { ok: false, error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" };

  let rows: Record<string, string>[];
  try {
    rows = await getSheetRows(spreadsheetId, "API Reuniones - IA");
  } catch (err: any) {
    return { ok: false, error: `Error leyendo Google Sheets: ${err.message}` };
  }

  if (rows.length === 0) return { ok: true, synced: 0, skipped: 0 };

  const supabase = supabaseAdmin();
  const { data: clients } = await supabase.from("clients").select("id, name, slug");
  const clientByName = new Map<string, string>();
  const clientNameById = new Map<string, string>();
  (clients ?? []).forEach((c) => {
    clientByName.set(normalizeName(c.name), c.id);
    if (c.slug) clientByName.set(normalizeName(c.slug), c.id);
    clientNameById.set(c.id, c.name);
  });

  let synced = 0;
  let skipped_sin_cliente = 0;
  let feedbacks_protegidos = 0;
  const errors: string[] = [];
  const previewItems: SyncPreviewItem[] = [];

  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) continue;

    const clientId = await resolveClientId(row, clientByName);
    const fechaReunion = parseDate(row["Fecha de la reunión"]);
    // Preferir el ID Reunión real de la planilla (columna agregada vía Apps
    // Script); si una fila todavía no lo tiene, usar la clave compuesta.
    const reunionId = row["ID Reunión"]?.trim();
    const sheetRowKey = reunionId || buildMatchKey(empresa, row["Contacto"]?.trim() ?? "", fechaReunion);

    // REGLA 1: Si no hay client_id resuelto → omitir completamente esta fila
    if (!clientId) {
      skipped_sin_cliente++;
      if (preview) {
        previewItems.push({ empresa, rowIndex: row.__rowIndex as any, reason: "sin_cliente" });
      }
      continue;
    }

    // Verificar si ya existe en BD
    const { data: existing } = await supabase
      .from("meetings")
      .select("id, client_id, feedback_status")
      .eq("sheet_row_key", sheetRowKey)
      .maybeSingle();

    // REGLA 2: Si ya tiene feedback → mantener client_id actual, no tocar nada
    if (existing?.feedback_status === "con_feedback" && existing?.client_id) {
      feedbacks_protegidos++;
      if (preview && existing.client_id !== clientId) {
        previewItems.push({
          empresa,
          rowIndex: row.__rowIndex as any,
          reason: "feedback_protegido",
          clienteActual: clientNameById.get(existing.client_id) ?? existing.client_id,
          clienteNuevo: clientNameById.get(clientId) ?? clientId,
          meetingId: existing.id,
          newClientId: clientId,
        });
      }
      if (!preview) {
        // Solo actualizar campos que no son client_id (nunca tocar reuniones con feedback)
        await supabase.from("meetings").update({
          realizado: normalizeRealizado(row["Realizado"] ?? ""),
          empresa,
          contacto_nombre:       row["Contacto"]                  || null,
          contacto_cargo:        row["Cargo"]                     || null,
          fecha_reunion:         fechaReunion,
          fecha_agendamiento:    parseDate(row["Fecha de agendamiento"]),
          hora:                  row["Hora"]                      || null,
          pais:                  row["País"]                      || null,
          propuesta_oportunidad: row["Propuesta/Oportunidad"]     || null,
          sales_manager:         row["Sales Manager"]             || null,
          notas:                 row["Comentario de la reunión"]  || null,
        }).eq("id", existing.id);
        synced++;
      }
      continue;
    }

    if (preview) continue;

    // REGLA NORMAL: upsert con el client_id resuelto
    const record = {
      sheet_row_key:         sheetRowKey,
      client_id:             clientId,
      empresa,
      contacto_nombre:       row["Contacto"]                 || null,
      contacto_cargo:        row["Cargo"]                    || null,
      fecha_reunion:         fechaReunion,
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

    if (error) errors.push(`Fila ${row.__rowIndex} (${empresa}): ${error.message}`);
    else synced++;
  }

  return {
    ok: true,
    synced,
    skipped: skipped_sin_cliente,
    skipped_sin_cliente,
    feedbacks_protegidos,
    errors: errors.length > 0 ? errors : undefined,
    preview: preview ? previewItems : undefined,
  };
}
