import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { canonicalCountry } from "@/lib/celulasSdr/country";
import { chileToday, monthEnd, monthStart } from "@/lib/celulasSdr/calendar";
import type { DataWarning, MeetingRecord, MeetingRecordsResponse, MeetingStatus } from "@/lib/celulasSdr/types";

// Módulo Células SDR — Registro de reuniones: las filas de la pestaña API
// Reuniones (tabla meetings, sincronizada cada hora) en un rango de fechas,
// por fecha de la reunión (md) o de agendamiento (sd). Solo lectura.
// Columnas permitidas: nombre y cargo del contacto, empresa, fechas, estado,
// oportunidad, origen y comentario. Teléfono y correo NO se leen.

const MAX_ROWS = 5000;

function toStatus(realizado: string | null | undefined): MeetingStatus {
  const v = (realizado ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  if (v === "si" || v === "yes") return "held";
  if (v === "no") return "noshow";
  if (v === "reagendar" || v === "re-agendar") return "resch";
  return "pending";
}

const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function loadMeetingRecords(params: URLSearchParams): Promise<MeetingRecordsResponse> {
  const today = chileToday();
  const field = params.get("field") === "sd" ? "sd" : "md";
  const from = isDay(params.get("from")) ? params.get("from")! : monthStart(today.slice(0, 7));
  const to = isDay(params.get("to")) ? params.get("to")! : monthEnd(today.slice(0, 7));
  if (from > to) throw new Error("La fecha desde es posterior a la fecha hasta");
  const col = field === "sd" ? "fecha_agendamiento" : "fecha_reunion";

  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const warnings: DataWarning[] = [];
  const master = await readMaster(spreadsheetId, warnings);
  const resolvePerson = makePersonResolver(master.people);

  const db = supabaseAdmin();
  const { data: clientRows } = await db.from("clients").select("id, name");
  const clientNames: Record<string, string> = {};
  for (const c of clientRows ?? []) clientNames[c.id as string] = c.name as string;

  // Paginado: PostgREST corta en 1000 filas
  const PAGE = 1000;
  const raw: any[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("meetings")
      .select("id, responsable, sdr_nombre, client_id, pais, fecha_agendamiento, fecha_reunion, hora, realizado, propuesta_oportunidad, origen, empresa, contacto_nombre, contacto_cargo, notas")
      .gte(col, from)
      .lte(col, to)
      .order(col, { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    raw.push(...(data ?? []));
    if (raw.length >= MAX_ROWS) { truncated = true; break; }
    if (!data || data.length < PAGE) break;
  }

  const sdrNames: Record<string, string> = {};
  const rows: MeetingRecord[] = raw.slice(0, MAX_ROWS).map((m) => {
    const person = resolvePerson((m.responsable || m.sdr_nombre || "Sin responsable").trim()).name;
    const sdr = resolveSdrKey(person);
    sdrNames[sdr] = sdrNames[sdr] ?? person;
    return {
      id: String(m.id),
      sdr,
      client: m.client_id ?? null,
      country: canonicalCountry(m.pais),
      sd: m.fecha_agendamiento ?? null,
      md: m.fecha_reunion ?? null,
      hour: (m.hora ?? "").trim() || null,
      st: toStatus(m.realizado),
      opp: (m.propuesta_oportunidad ?? "").trim(),
      origin: (m.origen ?? "").trim(),
      company: (m.empresa ?? "").trim(),
      contact: (m.contacto_nombre ?? "").trim(),
      title: (m.contacto_cargo ?? "").trim(),
      comment: (m.notas ?? "").trim(),
    };
  });

  return { from, to, field, today, rows, sdrNames, clientNames, truncated };
}
