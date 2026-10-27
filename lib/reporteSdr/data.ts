// Datos del Reporte SDR diario (correo de las 13:00 y 18:30, ver
// app/api/cron/reporte-sdr). Reutiliza TAL CUAL el cálculo de
// /api/analisis/sdr (Ranking SDR) con período "Hoy" y "Todos los clientes",
// para que el reporte muestre los mismos números que la pantalla
// Análisis → SDR.
//
// Reuniones agendadas (confirmado con BullsEye): se toman de la lista de
// reuniones del día (por fecha de agendamiento, la misma de "Origen de
// Reuniones") y se asignan a cada SDR por nombre normalizado. Un responsable
// de reuniones sin llamadas hoy aparece igual, con 0 llamadas.
import { NextRequest } from "next/server";
import { GET as sdrAnalyticsGET } from "@/app/api/analisis/sdr/route";
import { resolveSdrKey, normalizeSdrName } from "@/lib/sdrAnalytics";

// Personas fuera de la reportería (mismo criterio que Células SDR:
// EXCLUDED_PEOPLE en lib/celulasSdr/engine.ts — no se importa de ahí para
// no arrastrar todo el motor del dashboard al cron).
const EXCLUDED_PEOPLE = ["adolfo", "jose pablo"];
export function isExcludedPerson(name: string): boolean {
  const key = normalizeSdrName(name);
  return EXCLUDED_PEOPLE.some((x) => key === x || key.startsWith(`${x} `));
}

export type ReportRow = {
  name: string;
  calls: number;            // llamadas realizadas (Allo, salientes)
  contacts: number;         // contactos gestionados (números únicos)
  connected: number;        // llamadas conectadas
  meetings: number;         // reuniones agendadas hoy
};

export type ReportMeeting = {
  sdr: string;
  company: string;
  client: string;
  origin: string;
  meetingDate: string;      // YYYY-MM-DD (fecha de la reunión)
};

export type DailySdrReport = {
  day: string;              // YYYY-MM-DD (día de Chile del reporte)
  cutLabel: string;         // "13:00" / "18:30"
  rows: ReportRow[];
  meetings: ReportMeeting[];
  totals: { calls: number; contacts: number; connected: number; meetings: number };
};

export async function buildDailySdrReport(opts: { cutLabel: string; baseUrl?: string }): Promise<DailySdrReport> {
  const base = opts.baseUrl || "http://localhost";
  const req = new NextRequest(`${base}/api/analisis/sdr?client_id=__all__&rangeKey=today`);
  const res = await sdrAnalyticsGET(req);
  const body: any = await res.json();
  if (!res.ok || body?.error) throw new Error(`Ranking SDR: ${body?.error || res.status}`);

  const days: any[] = body.resultados_por_dia ?? [];
  // Con "Hoy" el arreglo trae un solo día; se toma el primero por si el
  // rango se extendiera (reuniones a futuro no cambian el día de hoy).
  const todayEntry = days[0] ?? { fecha: "", reuniones: [] };
  const day: string = todayEntry.fecha;

  const meetings: ReportMeeting[] = (todayEntry.reuniones ?? [])
    .filter((m: any) => !isExcludedPerson(m.sdr_nombre || ""))
    .map((m: any) => ({
      sdr: m.sdr_nombre || "Sin SDR",
      company: m.empresa || m.prospecto_nombre || "—",
      client: m.client_name || "",
      origin: m.origen || "",
      meetingDate: m.fecha_reunion || "",
    }))
    .sort((a: ReportMeeting, b: ReportMeeting) => a.sdr.localeCompare(b.sdr, "es"));

  const meetingsByKey = new Map<string, { display: string; n: number }>();
  for (const m of meetings) {
    const k = resolveSdrKey(m.sdr);
    const cur = meetingsByKey.get(k) ?? { display: m.sdr, n: 0 };
    cur.n++;
    meetingsByKey.set(k, cur);
  }

  const rows: ReportRow[] = [];
  const claimed = new Set<string>();
  for (const s of body.sdrs_data ?? []) {
    if (isExcludedPerson(s.sdr_nombre || "")) continue;
    const k = resolveSdrKey(s.sdr_nombre || "");
    // Filas "solo reuniones" del Ranking (responsables sin llamadas) se
    // recalculan abajo desde la lista de reuniones del día.
    if (!s.llamadas_realizadas && !s.contactos_gestionados) continue;
    claimed.add(k);
    rows.push({
      name: s.sdr_nombre,
      calls: s.llamadas_realizadas || 0,
      contacts: s.contactos_gestionados || 0,
      connected: s.llamadas_conectadas || 0,
      meetings: meetingsByKey.get(k)?.n ?? 0,
    });
  }
  for (const [k, v] of meetingsByKey) {
    if (claimed.has(k)) continue;
    rows.push({ name: v.display, calls: 0, contacts: 0, connected: 0, meetings: v.n });
  }
  rows.sort((a, b) => b.calls - a.calls || b.meetings - a.meetings || a.name.localeCompare(b.name, "es"));

  const totals = rows.reduce(
    (t, r) => ({ calls: t.calls + r.calls, contacts: t.contacts + r.contacts, connected: t.connected + r.connected, meetings: t.meetings }),
    { calls: 0, contacts: 0, connected: 0, meetings: meetings.length }
  );
  return { day, cutLabel: opts.cutLabel, rows, meetings, totals };
}

// ─── Formato ────────────────────────────────────────────────────────────────

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function formatShortDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function formatLongDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const dt = new Date(`${ymd}T12:00:00Z`);
  const [y, m, d] = ymd.split("-").map(Number);
  return `${WEEKDAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function pct(a: number, b: number): string {
  return b ? `${Math.round((a / b) * 100)}%` : "–";
}

// "Maria de los Angeles Perez" → "Maria Perez" (nombre + último apellido).
export function shortName(n: string): string {
  const p = n.trim().split(/\s+/);
  return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : n.trim();
}
