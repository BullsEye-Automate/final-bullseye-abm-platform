import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase/server";
import { updateSheetCellByKey } from "@/lib/googleSheets";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { readMasterPeople, resolveSdr, normName } from "@/lib/respuestasLemlist/directory";
import { chileNow, isPilotClient, isYes, reconfKey } from "@/lib/reconfirmacion/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Marca o desmarca "Reconfirmada con el prospecto" desde el Registro de
// reuniones de Células SDR (piloto de reconfirmación, lib/reconfirmacion).
// Escribe en la planilla API Reuniones - IA (fila por "ID Reunión") las
// columnas Reconfirmada (Sí/No) y Fecha reconfirmación (dd/MM/yyyy HH:mm, hora
// de Chile, como texto) y actualiza `meetings` al instante. Guarda además para
// qué fecha y hora era (`reconfirmada_para`): si la reunión se mueve, deja de
// valer. Pueden marcar: el SDR responsable de la reunión (por su correo en la
// Maestra), las líderes de célula e Ingri (editors.ts).

const SHEET = "API Reuniones - IA";

export async function POST(request: NextRequest) {
  try {
    let email: string | null = null;
    try {
      email = (await supabaseServer().auth.getUser()).data.user?.email ?? null;
    } catch { /* sin sesión legible */ }
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const value = body?.value === true;
    if (!id || typeof body?.value !== "boolean") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

    const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
    if (!spreadsheetId) return NextResponse.json({ error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" }, { status: 500 });

    const db = supabaseAdmin();
    const { data: m, error } = await db
      .from("meetings")
      .select("id, sheet_row_key, client_id, cliente_nombre, responsable, sdr_nombre, fecha_reunion, hora, realizado")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) return NextResponse.json({ error: "Reunión no encontrada" }, { status: 404 });

    // Solo clientes del piloto
    const { data: cli } = m.client_id ? await db.from("clients").select("name").eq("id", m.client_id).maybeSingle() : { data: null };
    if (!isPilotClient(m.cliente_nombre) && !isPilotClient(cli?.name)) {
      return NextResponse.json({ error: "Esta reunión no es de un cliente del piloto de reconfirmación" }, { status: 400 });
    }

    // Permiso: líderes / Ingri, o el SDR responsable de la reunión
    if (!canEditMeetings(email)) {
      const people = await readMasterPeople().catch(() => []);
      const res = resolveSdr(people, (m.responsable || m.sdr_nombre || "").trim());
      const own = res.person?.email && normName(res.person.email) === normName(email);
      if (!own) return NextResponse.json({ error: "Solo el SDR responsable de la reunión (o su líder) puede marcar la reconfirmación" }, { status: 403 });
    }

    const key = (m.sheet_row_key ?? "").trim();
    if (!key || key.includes("|")) {
      return NextResponse.json({ error: "Esta reunión no tiene ID Reunión en la planilla: márcala directo en el Excel" }, { status: 400 });
    }

    const now = chileNow();
    const at = value ? `${now.day.slice(8, 10)}/${now.day.slice(5, 7)}/${now.day.slice(0, 4)} ${now.time}` : null;
    const write = (header: string, v: string, expected?: (cur: string) => boolean) =>
      updateSheetCellByKey({ spreadsheetId, sheetName: SHEET, keyHeader: "ID Reunión", keyValue: key, targetHeader: header, value: v, expected });

    let r1;
    try {
      // Si ya estaba como se pide (otra persona la marcó), no se pisa la fecha original
      r1 = await write("Reconfirmada", value ? "Sí" : "No", (cur) => isYes(cur) !== value);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/permission|403|insufficient/i.test(msg)) {
        return NextResponse.json({ error: "La app no tiene permiso de edición en la planilla: compártela como Editor con la cuenta de servicio de Google." }, { status: 403 });
      }
      throw e;
    }
    if (!r1.ok && r1.reason !== "conflict") {
      const msg = r1.reason === "not_found" ? "No se encontró la reunión en la planilla (¿se borró la fila?)" : "La planilla no tiene la columna Reconfirmada";
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    const changed = r1.ok;
    // Texto con apóstrofo para que la planilla no lo convierta en fecha
    if (changed) await write("Fecha reconfirmación", at ? `'${at}` : "");

    const patch = changed
      ? { reconfirmada: value, reconfirmada_en: at, reconfirmada_para: value ? reconfKey(m.fecha_reunion, m.hora) : null }
      : value ? { reconfirmada: true, reconfirmada_para: reconfKey(m.fecha_reunion, m.hora) } : { reconfirmada: false, reconfirmada_para: null };
    const { error: upErr } = await db.from("meetings").update(patch).eq("id", id);
    if (upErr) throw new Error(upErr.message);

    const { data: fresh } = await db.from("meetings").select("reconfirmada, reconfirmada_en").eq("id", id).maybeSingle();
    return NextResponse.json({ ok: true, rc: { ok: !!fresh?.reconfirmada, at: fresh?.reconfirmada ? fresh?.reconfirmada_en ?? at : null } });
  } catch (err) {
    console.error("Error en /api/celulas-sdr/records/reconfirm:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
