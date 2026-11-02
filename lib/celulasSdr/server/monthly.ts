import { supabaseAdmin } from "@/lib/supabase";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, readAssignment, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { buildClientDirectory } from "./clientAccounts";
import { canonicalCountry } from "@/lib/celulasSdr/country";
import { chileToday } from "@/lib/celulasSdr/calendar";
import type { DataWarning, MonthlyMeetingRow, MonthlyMeetingsResponse } from "@/lib/celulasSdr/types";

// Módulo Células SDR — evolutivo mensual de reuniones de enero a la fecha
// (promedio de agendadas por SDR mes a mes). Igual que loadBase, atribuye
// cada reunión a "Responsable de la reunión" con los nombres de la Maestra,
// pero devuelve conteos agregados (sin empresas ni datos de contacto).

function isHeld(realizado: string | null | undefined): boolean {
  const v = (realizado ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  return v === "si" || v === "yes";
}

export async function loadMonthlyMeetings(yearParam: string | null): Promise<MonthlyMeetingsResponse> {
  const today = chileToday();
  const curYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : curYear;
  const lastMonth = year < curYear ? 12 : Number(today.slice(5, 7));
  const months = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const from = `${year}-01-01`;
  const to = year < curYear ? `${year}-12-31` : today;

  const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_MEETINGS_ID no configurado");
  const warnings: DataWarning[] = [];
  const master = await readMaster(spreadsheetId, warnings);
  const resolvePerson = makePersonResolver(master.people);

  const db = supabaseAdmin();
  // cuentas (Nisum Chile / Colombia / Perú…): mismas que el resto del módulo
  const { data: clientRows } = await db.from("clients").select("id, name, slug");
  const rawGoals = await readAssignment(spreadsheetId, resolvePerson, warnings, year).catch(() => []);
  const dir = buildClientDirectory((clientRows ?? []) as any, rawGoals);

  // Paginado: PostgREST corta en 1000 filas
  const PAGE = 1000;
  const rows: any[] = [];
  let cliCol = " cliente_nombre,";
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("meetings")
      .select("id, responsable, sdr_nombre, client_id," + cliCol + " pais, fecha_agendamiento, fecha_reunion, realizado")
      .or(`and(fecha_agendamiento.gte.${from},fecha_agendamiento.lte.${to}),and(fecha_reunion.gte.${from},fecha_reunion.lte.${to})`)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error && cliCol && /cliente_nombre/.test(error.message)) { cliCol = ""; offset -= PAGE; continue; }
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const byKey = new Map<string, MonthlyMeetingRow>();
  const sdrNames: Record<string, string> = {};
  const bump = (m: string, s: string, c: string | null, k: string | null, field: "sched" | "held") => {
    const id = `${m}|${s}|${c ?? ""}|${k ?? ""}`;
    const r = byKey.get(id) ?? { m, s, c, k, sched: 0, held: 0 };
    r[field]++;
    byKey.set(id, r);
  };
  for (const r of rows) {
    const person = resolvePerson((r.responsable || r.sdr_nombre || "Sin responsable").trim()).name;
    const s = resolveSdrKey(person);
    sdrNames[s] = sdrNames[s] ?? person;
    const k = canonicalCountry(r.pais);
    const c = dir.toAccount(r.client_id ?? null, r.cliente_nombre, k);
    const sm = (r.fecha_agendamiento ?? "").slice(0, 7);
    if (months.includes(sm) && r.fecha_agendamiento <= to) bump(sm, s, c, k, "sched");
    const mm = (r.fecha_reunion ?? "").slice(0, 7);
    if (isHeld(r.realizado) && months.includes(mm) && r.fecha_reunion <= to) bump(mm, s, c, k, "held");
  }

  return { year, months, today, rows: [...byKey.values()], sdrNames };
}
