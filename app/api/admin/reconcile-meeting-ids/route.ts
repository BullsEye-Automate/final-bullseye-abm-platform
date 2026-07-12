import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSheetRows } from "@/lib/googleSheets";
import { buildMatchKey, parseDate } from "@/lib/syncMeetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Endpoint de una sola vez: la planilla ahora tiene una columna "ID Reunión"
// (UUID estable por fila, vía Apps Script) en vez de depender de la
// posición de fila. Este endpoint:
//   1. Agrupa las reuniones ya existentes en Supabase por contenido
//      (empresa+contacto+fecha) y fusiona duplicados generados por el bug
//      viejo (conservando la que tiene feedback, o la más reciente).
//   2. Para cada sobreviviente, busca su fila correspondiente en la
//      planilla y actualiza sheet_row_key al "ID Reunión" real.
//
// GET  ?commit=1   → ejecuta de verdad
// GET  (sin commit) → solo reporta qué haría, no escribe nada
//
// Borrar este archivo una vez ejecutado con éxito.
export async function GET(req: NextRequest) {
  const commit = req.nextUrl.searchParams.get("commit") === "1";

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

  const db = supabaseAdmin();
  const { data: meetings, error } = await db
    .from("meetings")
    .select("id, empresa, contacto_nombre, fecha_reunion, feedback_status, updated_at, created_at, sheet_row_key");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Meeting = NonNullable<typeof meetings>[number];

  // 1. Agrupar por clave de contenido y elegir un ganador por grupo
  const groups = new Map<string, Meeting[]>();
  for (const m of meetings ?? []) {
    const key = buildMatchKey(m.empresa, m.contacto_nombre ?? "", m.fecha_reunion);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const toDelete: string[] = [];
  const winnerByKey = new Map<string, Meeting>();

  for (const [key, group] of groups) {
    if (group.length === 1) {
      winnerByKey.set(key, group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const fa = a.feedback_status === "con_feedback" ? 1 : 0;
      const fb = b.feedback_status === "con_feedback" ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    winnerByKey.set(key, sorted[0]);
    toDelete.push(...sorted.slice(1).map((m) => m.id));
  }

  // 2. Para cada fila de la planilla con ID Reunión, actualizar el
  //    sheet_row_key del ganador correspondiente al ID real.
  const updates: { id: string; newKey: string }[] = [];
  let filasSinIdEnPlanilla = 0;
  let filasSinMatchEnBD = 0;

  for (const row of rows) {
    const empresa = row["Empresa"]?.trim();
    if (!empresa) continue;

    const reunionId = row["ID Reunión"]?.trim();
    if (!reunionId) {
      filasSinIdEnPlanilla++;
      continue;
    }

    const fecha = parseDate(row["Fecha de la reunión"]);
    const key = buildMatchKey(empresa, row["Contacto"]?.trim() ?? "", fecha);
    const winner = winnerByKey.get(key);
    if (!winner) {
      filasSinMatchEnBD++;
      continue;
    }
    if (winner.sheet_row_key !== reunionId) {
      updates.push({ id: winner.id, newKey: reunionId });
    }
  }

  if (!commit) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      duplicados_a_fusionar_borrar: toDelete.length,
      claves_a_actualizar: updates.length,
      filas_planilla_sin_id_reunion: filasSinIdEnPlanilla,
      filas_planilla_sin_match_en_bd: filasSinMatchEnBD,
      nota: "Nada se modificó. Repetir con ?commit=1 para ejecutar de verdad.",
    });
  }

  if (toDelete.length > 0) {
    const { error: delError } = await db.from("meetings").delete().in("id", toDelete);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  let actualizadas = 0;
  const errors: string[] = [];
  for (const u of updates) {
    const { error: upError } = await db
      .from("meetings")
      .update({ sheet_row_key: u.newKey })
      .eq("id", u.id);
    if (upError) errors.push(`${u.id}: ${upError.message}`);
    else actualizadas++;
  }

  return NextResponse.json({
    ok: true,
    duplicados_borrados: toDelete.length,
    claves_actualizadas: actualizadas,
    filas_planilla_sin_id_reunion: filasSinIdEnPlanilla,
    filas_planilla_sin_match_en_bd: filasSinMatchEnBD,
    errores: errors.length ? errors : undefined,
  });
}
