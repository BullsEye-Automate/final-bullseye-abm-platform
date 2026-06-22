import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSheetRows } from "@/lib/googleSheets";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!
);

function parseDate(str: string): string | null {
  if (!str) return null;
  // Acepta DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return null;
  if (parts[2].length === 4) {
    // DD/MM/YYYY
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  return str; // ya en YYYY-MM-DD
}

function normalizeRealizado(val: string): string {
  const v = val.trim().toLowerCase();
  if (v === "si" || v === "sí" || v === "yes")   return "Si";
  if (v === "no")                                  return "No";
  if (v === "reagendar" || v === "re-agendar")    return "Reagendar";
  return "Pendiente";
}

export async function GET(req: NextRequest) {
  // Verificar cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) {
    return NextResponse.json({ error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" }, { status: 500 });
  }

  let rows: Record<string, string>[];
  try {
    rows = await getSheetRows(spreadsheetId, "API Reuniones - IA");
  } catch (err: any) {
    return NextResponse.json({ error: `Error leyendo Google Sheets: ${err.message}` }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, message: "Hoja vacía" });
  }

  // Cargar clientes para mapear nombre → id
  const { data: clients } = await supabase.from("clients").select("id, name");
  const clientByName = new Map<string, string>();
  (clients ?? []).forEach((c) => clientByName.set(c.name.toLowerCase().trim(), c.id));

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) { skipped++; continue; }

    // Resolver client_id — primero por ID explícito, luego por nombre
    let clientId: string | null = row["ID Cliente"]?.trim() || null;
    if (!clientId) {
      const clientNombre = row["Cliente"]?.trim().toLowerCase();
      if (clientNombre) clientId = clientByName.get(clientNombre) ?? null;
    }

    // Clave única: spreadsheet_id + row index para evitar duplicados
    const sheetRowKey = `${spreadsheetId}::${row.__rowIndex}`;

    const fechaReunion     = parseDate(row["Fecha de la reunión"]);
    const fechaAgendamiento = parseDate(row["Fecha de agendamiento"]);

    const record = {
      sheet_row_key:         sheetRowKey,
      client_id:             clientId,
      empresa,
      contacto_nombre:       row["Contacto"]               || null,
      contacto_cargo:        row["Cargo"]                  || null,
      fecha_reunion:         fechaReunion,
      fecha_agendamiento:    fechaAgendamiento,
      hora:                  row["Hora"]                   || null,
      pais:                  row["País"]                   || null,
      realizado:             normalizeRealizado(row["Realizado"] ?? ""),
      origen:                row["Origen"]                 || null,
      responsable:           row["Responsable de la reunión"] || null,
      propuesta_oportunidad: row["Propuesta/Oportunidad"]  || null,
      sales_manager:         row["Sales Manager"]          || null,
      telefono:              row["Teléfono"]               || null,
      correo:                row["Correo"]                 || null,
      industria:             row["Industria"]              || null,
      notas:                 row["Comentario de la reunión"] || null,
      hora_formulario:       row["Hora envío formulario"]  || null,
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

  return NextResponse.json({
    ok: true,
    synced,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
