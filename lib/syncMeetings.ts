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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
  orphans_detected?: number;
  orphans_deleted?: number;
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
// sinceDays: si se pasa, solo procesa filas cuya fecha de reunión o de
// agendamiento cae dentro de esa ventana (además de las filas sin ninguna
// fecha parseable, que se procesan siempre por seguridad) — los días ya
// pasados casi no cambian, así que el botón manual del portal usa una
// ventana acotada para responder rápido; el cron nocturno sigue corriendo
// sin este filtro (sync completo) para no dejar nada desactualizado
// permanentemente.
export async function runMeetingsSync(preview = false, sinceDays?: number): Promise<SyncResult> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) return { ok: false, error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" };

  let rows: Record<string, string>[];
  try {
    rows = await getSheetRows(spreadsheetId, "API Reuniones - IA");
  } catch (err: any) {
    return { ok: false, error: `Error leyendo Google Sheets: ${err.message}` };
  }

  if (rows.length === 0) return { ok: true, synced: 0, skipped: 0 };

  if (sinceDays) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - sinceDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    rows = rows.filter((row) => {
      const fReunion = parseDate(row["Fecha de la reunión"]);
      const fAgenda = parseDate(row["Fecha de agendamiento"]);
      if (!fReunion && !fAgenda) return true; // sin fecha detectable: mejor sincronizar de más
      return (!!fReunion && fReunion >= cutoffStr) || (!!fAgenda && fAgenda >= cutoffStr);
    });
  }

  const supabase = supabaseAdmin();
  const { data: clients } = await supabase.from("clients").select("id, name, slug");
  const clientByName = new Map<string, string>();
  const clientNameById = new Map<string, string>();
  (clients ?? []).forEach((c) => {
    clientByName.set(normalizeName(c.name), c.id);
    if (c.slug) clientByName.set(normalizeName(c.slug), c.id);
    clientNameById.set(c.id, c.name);
  });

  // Calcula la sheet_row_key de cada fila de una sola pasada, y con eso
  // trae TODAS las meetings existentes relevantes en unos pocos SELECT en
  // vez de uno por fila — antes se hacía un select + upsert secuencial por
  // cada una de las ~2000+ filas de la planilla (patrón N+1, miles de
  // round-trips), lo que muy probablemente hacía que el cron nocturno
  // (corre sin ventana de fecha, sobre toda la planilla) nunca alcanzara a
  // terminar antes de que la función se cortara por timeout, dejando la
  // sincronización crónicamente incompleta.
  const allSheetRowKeys = new Set<string>();
  const rowsWithKey: {
    row: Record<string, string>;
    empresa: string;
    fechaReunion: string | null;
    sheetRowKey: string;
  }[] = [];
  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) continue;
    const fechaReunion = parseDate(row["Fecha de la reunión"]);
    // Preferir el ID Reunión real de la planilla (columna agregada vía Apps
    // Script); si una fila todavía no lo tiene, usar la clave compuesta.
    const reunionId = row["ID Reunión"]?.trim();
    const sheetRowKey = reunionId || buildMatchKey(empresa, row["Contacto"]?.trim() ?? "", fechaReunion);
    allSheetRowKeys.add(sheetRowKey);
    rowsWithKey.push({ row, empresa, fechaReunion, sheetRowKey });
  }

  const existingByKey = new Map<string, { id: string; client_id: string | null; feedback_status: string | null }>();
  for (const keysChunk of chunk([...allSheetRowKeys], 200)) {
    const { data } = await supabase
      .from("meetings")
      .select("id, client_id, feedback_status, sheet_row_key")
      .in("sheet_row_key", keysChunk);
    for (const m of data ?? []) {
      if (m.sheet_row_key) existingByKey.set(m.sheet_row_key, m);
    }
  }

  let skipped_sin_cliente = 0;
  let feedbacks_protegidos = 0;
  const errors: string[] = [];
  const previewItems: SyncPreviewItem[] = [];
  // Se acumula en un Map (no un array) para que, si dos filas de la
  // planilla llegaran a calcular la misma sheet_row_key, la última gane —
  // igual que con los upserts secuenciales de antes — y no se rompa el
  // upsert por lote (Postgres no permite que un mismo UPSERT afecte la
  // misma fila dos veces).
  const normalBatch = new Map<string, Record<string, unknown>>();
  const protectedBatch = new Map<string, Record<string, unknown>>();

  for (const { row, empresa, fechaReunion, sheetRowKey } of rowsWithKey) {
    // Se busca ANTES de resolver client_id (y no solo cuando resuelve) para
    // poder recuperar el client_id ya guardado si esta fila pierde "ID
    // Cliente"/"Cliente" en la planilla (ej. un Apps Script externo que
    // reescribe la fila al procesar un "rescate" de reunión y borra esas
    // columnas) — sin esto, una reunión ya sincronizada se saltaba entera
    // (REGLA 1) apenas la planilla perdía el dato, y el nuevo estado
    // ("Pendiente" del rescate) nunca llegaba a Supabase.
    const existing = existingByKey.get(sheetRowKey);
    const clientId = (await resolveClientId(row, clientByName)) || existing?.client_id || null;

    // REGLA 1: Si no hay client_id resuelto (ni desde la planilla ni desde
    // un registro ya existente) → omitir completamente esta fila
    if (!clientId) {
      skipped_sin_cliente++;
      if (preview) {
        previewItems.push({ empresa, rowIndex: row.__rowIndex as any, reason: "sin_cliente" });
      }
      continue;
    }

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
        protectedBatch.set(sheetRowKey, {
          sheet_row_key:         sheetRowKey,
          realizado:             normalizeRealizado(row["Realizado"] ?? ""),
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
        });
      }
      continue;
    }

    if (preview) continue;

    // REGLA NORMAL: upsert con el client_id resuelto
    normalBatch.set(sheetRowKey, {
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
    });
  }

  let synced = 0;
  if (!preview) {
    for (const c of chunk([...normalBatch.values()], 500)) {
      const { error } = await supabase.from("meetings").upsert(c, { onConflict: "sheet_row_key" });
      if (error) errors.push(`Upsert de ${c.length} reunion(es): ${error.message}`);
      else synced += c.length;
    }
    for (const c of chunk([...protectedBatch.values()], 500)) {
      const { error } = await supabase.from("meetings").upsert(c, { onConflict: "sheet_row_key" });
      if (error) errors.push(`Upsert (con feedback protegido) de ${c.length} reunion(es): ${error.message}`);
      else synced += c.length;
    }
  }

  // Reuniones "fantasma": el sync de arriba solo hace upsert de lo que SÍ
  // está en la planilla — nunca borra lo que desaparece de ella (ej. un
  // duplicado que el SDR eliminó del Sheet, a veces dejando en el
  // comentario algo como "se ingresó 2 veces"). Sin esto, esa reunión
  // queda congelada en Supabase con su último estado (Pendiente/Reagendar)
  // para siempre, apareciendo como pendiente en los reportes aunque ya no
  // exista en el origen. Solo se corre en un sync completo (sinceDays sin
  // definir): en un sync acotado por ventana, "no está en `rows`" no
  // significa "ya no existe en el Sheet", solo que cae fuera del rango de
  // días consultado.
  let orphans_detected: number | undefined;
  let orphans_deleted: number | undefined;
  if (!sinceDays && !preview) {
    // Tope de seguridad: si getSheetRows alguna vez trae menos filas de las
    // que debería (fallo parcial de la API de Sheets), no queremos borrar
    // en masa reuniones que en realidad siguen vigentes en el Sheet real —
    // se aborta el borrado y se reporta el conteo para revisión manual.
    const MAX_ORPHANS_PER_RUN = 30;
    const { data: openMeetings } = await supabase
      .from("meetings")
      .select("id, sheet_row_key")
      .in("realizado", ["Pendiente", "Reagendar"])
      .not("sheet_row_key", "is", null);

    const orphanIds = (openMeetings ?? [])
      .filter((m) => m.sheet_row_key && !allSheetRowKeys.has(m.sheet_row_key))
      .map((m) => m.id);

    orphans_detected = orphanIds.length;

    if (orphanIds.length > 0 && orphanIds.length <= MAX_ORPHANS_PER_RUN) {
      orphans_deleted = 0;
      for (const id of orphanIds) {
        // Uno por uno: el trigger prevent_delete_meeting_with_feedback
        // puede rechazar una fila puntual (protege reuniones con feedback
        // ya registrado) — en un DELETE por lote, eso abortaría el lote
        // completo y no se limpiaría ninguna.
        const { error } = await supabase.from("meetings").delete().eq("id", id);
        if (error) errors.push(`No se pudo limpiar reunión fantasma ${id}: ${error.message}`);
        else orphans_deleted++;
      }
    } else if (orphanIds.length > MAX_ORPHANS_PER_RUN) {
      errors.push(
        `${orphanIds.length} reuniones "fantasma" detectadas (más del tope de seguridad de ${MAX_ORPHANS_PER_RUN}) — no se borró ninguna, requiere revisión manual.`
      );
    }
  }

  return {
    ok: true,
    synced,
    skipped: skipped_sin_cliente,
    skipped_sin_cliente,
    feedbacks_protegidos,
    orphans_detected,
    orphans_deleted,
    errors: errors.length > 0 ? errors : undefined,
    preview: preview ? previewItems : undefined,
  };
}
