import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase/server";
import { updateSheetCellByKey } from "@/lib/googleSheets";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import type { MeetingStatus } from "@/lib/celulasSdr/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cambia el estado ("Realizado") de una reunión desde el Registro de
// reuniones: escribe la celda en la planilla API Reuniones (fila por
// "ID Reunión"), actualiza meetings al instante y deja el cambio en
// meeting_status_changes. Solo líderes de célula e Ingri (editors.ts).
// Si la planilla ya tiene otro valor que el que veía el usuario, no pisa
// nada: responde 409 con el valor actual (y lo sincroniza en meetings).

const SHEET = "API Reuniones - IA";
const TO_SHEET: Record<MeetingStatus, string> = { held: "Si", noshow: "No", resch: "Reagendar", pending: "Pendiente" };

function toStatus(v: string): MeetingStatus {
  const n = v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  if (n === "si" || n === "yes") return "held";
  if (n === "no") return "noshow";
  if (n === "reagendar" || n === "re-agendar") return "resch";
  return "pending";
}

export async function POST(request: NextRequest) {
  try {
    let email: string | null = null;
    try {
      email = (await supabaseServer().auth.getUser()).data.user?.email ?? null;
    } catch { /* sin sesión legible */ }
    if (!canEditMeetings(email)) return NextResponse.json({ error: "No tienes permiso para editar reuniones" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const status = body?.status as MeetingStatus;
    const from = body?.from as MeetingStatus;
    if (!id || !(status in TO_SHEET) || !(from in TO_SHEET)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

    const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
    if (!spreadsheetId) return NextResponse.json({ error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" }, { status: 500 });

    const db = supabaseAdmin();
    const { data: m, error } = await db.from("meetings").select("id, sheet_row_key, empresa, realizado").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });
    const key = (m.sheet_row_key ?? "").trim();
    if (!key || key.includes("|")) {
      return NextResponse.json({ error: "Esta reunión no tiene ID Reunión en la planilla: edítala directo en el Excel" }, { status: 400 });
    }

    let res;
    try {
      res = await updateSheetCellByKey({
        spreadsheetId, sheetName: SHEET, keyHeader: "ID Reunión", keyValue: key, targetHeader: "Realizado",
        value: TO_SHEET[status], expected: (cur) => toStatus(cur) === from,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/permission|403|insufficient/i.test(msg)) {
        return NextResponse.json({ error: "La app no tiene permiso de edición en la planilla: compártela como Editor con la cuenta de servicio de Google." }, { status: 403 });
      }
      throw e;
    }

    if (!res.ok) {
      if (res.reason === "conflict") {
        const cur = toStatus(res.current ?? "");
        await db.from("meetings").update({ realizado: TO_SHEET[cur] }).eq("id", id);
        return NextResponse.json({ error: `En la planilla esta reunión ya está como "${TO_SHEET[cur]}". Se actualizó la vista.`, current: cur }, { status: 409 });
      }
      const msg = res.reason === "not_found" ? "No se encontró la reunión en la planilla (¿se borró la fila?)" : "No se encontraron las columnas ID Reunión / Realizado en la planilla";
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    await db.from("meetings").update({ realizado: TO_SHEET[status] }).eq("id", id);
    const { error: logErr } = await db.from("meeting_status_changes").insert({
      meeting_id: id, sheet_row_key: key, empresa: m.empresa, old_status: res.previous || null, new_status: TO_SHEET[status], changed_by: email,
    });
    if (logErr) console.error("meeting_status_changes:", logErr.message);
    return NextResponse.json({ ok: true, status, row: res.row });
  } catch (err) {
    console.error("Error en /api/celulas-sdr/records/status:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
