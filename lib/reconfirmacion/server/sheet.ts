import { supabaseAdmin } from "@/lib/supabase";
import { getSheetRows } from "@/lib/googleSheets";
import { buildMatchKey, parseDate } from "@/lib/syncMeetings";
import { cleanReconfDate, isPilotClient, isYes, pilotClients } from "../rules";

// Reconfirmación — lectura en vivo de "API Reuniones - IA" para los clientes
// del piloto. La usan el cron de alertas (necesita el estado al minuto, no el
// del último sync horario) y deja copiada la reconfirmación en `meetings`
// para Células SDR y Pulso ABM.

const SHEET = "API Reuniones - IA";

export type PilotMeeting = {
  key: string;            // ID Reunión (o clave compuesta, como el sync)
  sdr: string;            // Responsable de la reunión
  client: string;         // columna Cliente
  company: string;
  contact: string;
  title: string;          // cargo
  md: string | null;      // fecha de la reunión YYYY-MM-DD
  hour: string;           // hora tal cual
  pending: boolean;       // Realizado = Pendiente (o vacío)
  reconfirmed: boolean;
  reconfirmedAt: string | null;
};

function isPending(realizado: string | null | undefined): boolean {
  const v = (realizado ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return v === "" || v === "pendiente";
}

// Reuniones de clientes del piloto con fecha de reunión desde `sinceDay`
export async function readPilotMeetings(sinceDay: string): Promise<{ meetings: PilotMeeting[]; hasColumns: boolean }> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const rows = await getSheetRows(spreadsheetId, SHEET);
  const pilots = pilotClients();
  const hasColumns = rows.some((r) => "Reconfirmada" in r);
  const meetings: PilotMeeting[] = [];
  for (const r of rows) {
    if (!isPilotClient(r["Cliente"], pilots)) continue;
    const company = (r["Empresa"] ?? "").trim();
    if (!company) continue;
    const md = parseDate(r["Fecha de la reunión"]);
    if (!md || md < sinceDay) continue;
    const reconfirmed = isYes(r["Reconfirmada"]);
    meetings.push({
      key: r["ID Reunión"]?.trim() || buildMatchKey(company, r["Contacto"]?.trim() ?? "", md),
      sdr: (r["Responsable de la reunión"] ?? "").trim(),
      client: (r["Cliente"] ?? "").trim(),
      company,
      contact: (r["Contacto"] ?? "").trim(),
      title: (r["Cargo"] ?? "").trim(),
      md,
      hour: (r["Hora"] ?? "").trim(),
      pending: isPending(r["Realizado"]),
      reconfirmed,
      reconfirmedAt: reconfirmed ? cleanReconfDate(r["Fecha reconfirmación"]) : null,
    });
  }
  return { meetings, hasColumns };
}

// Copia la reconfirmación a `meetings` (solo las filas que cambiaron). Sin la
// migración 20261112 no hace nada.
export async function syncPilotReconfirmations(meetings: PilotMeeting[]): Promise<{ updated: number; skipped?: string }> {
  const db = supabaseAdmin();
  const { error: colErr } = await db.from("meetings").select("reconfirmada").limit(1);
  if (colErr) return { updated: 0, skipped: "Falta la migración 20261112_meetings_reconfirmacion.sql" };
  const byKey = new Map(meetings.map((m) => [m.key, m]));
  const keys = [...byKey.keys()];
  let updated = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db.from("meetings").select("id, sheet_row_key, reconfirmada, reconfirmada_en").in("sheet_row_key", keys.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const m = byKey.get(row.sheet_row_key);
      if (!m) continue;
      const at = m.reconfirmed ? m.reconfirmedAt : null;
      if (!!row.reconfirmada === m.reconfirmed && (row.reconfirmada_en ?? null) === at) continue;
      const { error: upErr } = await db.from("meetings").update({ reconfirmada: m.reconfirmed, reconfirmada_en: at }).eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      updated++;
    }
  }
  return { updated };
}
