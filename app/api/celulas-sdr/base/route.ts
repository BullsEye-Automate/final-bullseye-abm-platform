import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeName } from "@/lib/syncMeetings";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { readMaster, readAssignment, makePersonResolver } from "@/lib/celulasSdr/sheets";
import { canonicalCountry } from "@/lib/celulasSdr/country";
import { chileToday, monthEnd, monthStart, shiftMonth } from "@/lib/celulasSdr/calendar";
import type { BaseResponse, CellLeader, Client, DataWarning, Goal, Meeting, MeetingStatus, Sdr } from "@/lib/celulasSdr/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Módulo Células SDR — datos base (sin Allo ni HubSpot, que van por mes en
// rutas aparte porque son lentos): estructura de células, SDR, clientes,
// metas de la pestaña Asignación y reuniones de la pestaña API Reuniones
// (ya sincronizadas en la tabla meetings, ver lib/syncMeetings.ts).
//
// ?month=YYYY-MM es el último mes a cargar; se cargan además los 2 meses
// anteriores (comparación vs período anterior y tendencias de 8 semanas).
// Nunca se devuelven datos de contacto de prospectos.

const MONTHS_LOADED = 3;

// Paleta de SDR / células, adaptada a los colores de la app.
const SDR_PALETTE = ["#3D2878", "#E0457B", "#14A39A", "#F08A3E", "#7F77DD", "#2F80ED", "#1F9D74", "#C2410C", "#B83280", "#0E7490", "#8B5CF6", "#4D7C0F", "#B45309", "#475569", "#DB2777", "#0369A1"];
const CELL_COLORS = ["#5B4BD5", "#14A39A", "#F08A3E", "#E0457B"];

// Nombres de cliente de la pestaña Asignación que difieren del nombre en la
// tabla clients más allá de mayúsculas/tildes. Se agrega una línea cuando
// la pantalla avise un cliente sin calzar.
const CLIENT_NAME_ALIASES: Record<string, string> = {
  ccch: "cchc",
  "ccch - valle": "cchc - valle",
};

function normStatus(v: string | null | undefined): string {
  return (v ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

function toStatus(realizado: string | null | undefined): MeetingStatus {
  const v = normStatus(realizado);
  if (v === "si" || v === "yes") return "held";
  if (v === "no") return "noshow";
  if (v === "reagendar" || v === "re-agendar") return "resch";
  return "pending";
}

function initials(name: string): string {
  const parts = name.replace(/ de (los |las |la )?/gi, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// "María de los Ángeles Pérez" → "Mª Ángeles", "María José" → "María José",
// "Ivo Navarro" → "Ivo".
function shortName(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  if (/^mar[ií]a$/i.test(p[0] ?? "") && p.length > 1) {
    if (/^de$/i.test(p[1]) && p.length > 2) return `Mª ${p[p.length > 3 ? 3 : 2]}`;
    return `${p[0]} ${p[1]}`;
  }
  return p[0] ?? name;
}

export async function GET(request: NextRequest) {
  try {
    const today = chileToday();
    const monthParam = request.nextUrl.searchParams.get("month");
    const lastMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7);
    const months = Array.from({ length: MONTHS_LOADED }, (_, i) => shiftMonth(lastMonth, i - (MONTHS_LOADED - 1)));
    const from = monthStart(months[0]);
    const to = monthEnd(lastMonth);
    const warnings: DataWarning[] = [];
    const db = supabaseAdmin();

    const spreadsheetId = process.env.GOOGLE_SHEETS_MEETINGS_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "GOOGLE_SHEETS_MEETINGS_ID no configurado" }, { status: 500 });
    }

    // 1. Maestra (células) y Asignación (metas)
    const master = await readMaster(spreadsheetId, warnings);
    const resolvePerson = makePersonResolver(master.people);
    const rawGoals = await readAssignment(spreadsheetId, resolvePerson, warnings, Number(lastMonth.slice(0, 4)));

    // 2. Clientes
    const { data: clientRows, error: clientsErr } = await db.from("clients").select("id, name, slug");
    if (clientsErr) return NextResponse.json({ error: clientsErr.message }, { status: 500 });
    const clientByNorm = new Map<string, Client>();
    const clients = new Map<string, Client>();
    for (const c of clientRows ?? []) {
      const cl = { id: c.id as string, name: c.name as string };
      clients.set(cl.id, cl);
      clientByNorm.set(normalizeName(cl.name), cl);
      if (c.slug) clientByNorm.set(normalizeName(c.slug), cl);
    }
    const unmatchedClients = new Set<string>();
    const resolveClient = (raw: string): Client => {
      const n0 = normalizeName(raw);
      const n = CLIENT_NAME_ALIASES[n0] ?? n0;
      const exact = clientByNorm.get(n);
      if (exact) return exact;
      const partial = [...clientByNorm.entries()].filter(([k]) => k.startsWith(n) || n.startsWith(k));
      const uniq = [...new Set(partial.map(([, c]) => c.id))];
      if (uniq.length === 1) return clients.get(uniq[0])!;
      unmatchedClients.add(raw.trim());
      const id = `name:${n}`;
      if (!clients.has(id)) clients.set(id, { id, name: raw.trim() });
      return clients.get(id)!;
    };

    // 3. Metas de los meses cargados
    const goals: Goal[] = [];
    const goalPeople = new Map<string, string>(); // key → nombre
    for (const g of rawGoals) {
      if (!months.includes(g.month)) continue;
      const client = resolveClient(g.client);
      const key = resolveSdrKey(g.person);
      goalPeople.set(key, g.person);
      goals.push({ month: g.month, sdr: key, client: client.id, goal: g.goal });
    }
    for (const m of months) {
      if (m <= today.slice(0, 7) && !goals.some((g) => g.month === m)) {
        warnings.push({ source: "Asignación", message: `No se encontró el bloque de metas de ${m} en la pestaña Asignación.` });
      }
    }
    if (unmatchedClients.size) {
      warnings.push({
        source: "Asignación",
        message: `Clientes de Asignación que no calzan con la tabla de clientes: ${[...unmatchedClients].join(", ")}.`,
      });
    }

    // 4. Reuniones (todas las de cualquier origen) cuya fecha de
    // agendamiento o de reunión cae en la ventana. Paginado: PostgREST
    // corta en 1000 filas (ver /api/analisis/sdr).
    const PAGE = 1000;
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db
        .from("meetings")
        .select("id, responsable, sdr_nombre, client_id, pais, fecha_agendamiento, fecha_reunion, realizado, propuesta_oportunidad, origen")
        .or(`and(fecha_reunion.gte.${from},fecha_reunion.lte.${to}),and(fecha_agendamiento.gte.${from},fecha_agendamiento.lte.${to})`)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    const meetingPeople = new Map<string, string>();
    const oppValues = new Set<string>();
    const meetings: Meeting[] = rows.map((m) => {
      const rawName = (m.responsable || m.sdr_nombre || "Sin responsable").trim();
      const person = resolvePerson(rawName).name;
      const key = resolveSdrKey(person);
      if (!meetingPeople.has(key)) meetingPeople.set(key, person);
      const opp = normStatus(m.propuesta_oportunidad);
      if (opp) oppValues.add(opp);
      if (m.client_id && !clients.has(m.client_id)) clients.set(m.client_id, { id: m.client_id, name: "Cliente desconocido" });
      return {
        sdr: key,
        client: m.client_id ?? null,
        country: canonicalCountry(m.pais),
        sd: m.fecha_agendamiento ?? null,
        md: m.fecha_reunion ?? null,
        st: toStatus(m.realizado),
        opp,
        origin: (m.origen ?? "").trim(),
      };
    });

    // Registros incompletos (todo el historial): reuniones "Pendiente" con
    // fecha ya pasada, y reuniones sin fecha de reunión.
    const [pastPendingRes, invalidRes] = await Promise.all([
      db.from("meetings").select("id", { count: "exact", head: true }).eq("realizado", "Pendiente").lt("fecha_reunion", today),
      db.from("meetings").select("id", { count: "exact", head: true }).is("fecha_reunion", null),
    ]);

    // 5. Roster: líderes, integrantes de célula, personas con meta y
    // responsables de reuniones en la ventana.
    const activeByKey = new Map(master.people.map((p) => [resolveSdrKey(p.name), p.active]));
    const leaders: CellLeader[] = master.cells
      .map((c) => ({ key: resolveSdrKey(c.leader), name: c.leader }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((l, i) => ({ ...l, short: l.name.split(" ")[0], color: CELL_COLORS[i % CELL_COLORS.length] }));
    const leaderKeys = new Set(leaders.map((l) => l.key));
    const cellOf = new Map<string, string>();
    for (const c of master.cells) for (const m of c.members) cellOf.set(resolveSdrKey(m), resolveSdrKey(c.leader));

    const people = new Map<string, string>();
    for (const c of master.cells) {
      people.set(resolveSdrKey(c.leader), c.leader);
      for (const m of c.members) people.set(resolveSdrKey(m), m);
    }
    for (const [k, n] of goalPeople) if (!people.has(k)) people.set(k, n);
    for (const [k, n] of meetingPeople) if (!people.has(k)) people.set(k, n);

    const sdrs: Sdr[] = [...people.entries()]
      .sort((a, b) => {
        const ga = leaderKeys.has(a[0]) ? 1 : cellOf.has(a[0]) ? 0 : 2;
        const gb = leaderKeys.has(b[0]) ? 1 : cellOf.has(b[0]) ? 0 : 2;
        return ga - gb || a[1].localeCompare(b[1], "es");
      })
      .map(([key, name], i) => ({
        key,
        name,
        short: shortName(name),
        initials: initials(name),
        group: leaderKeys.has(key) ? "leader" : cellOf.has(key) ? "cell" : "none",
        leaderKey: leaderKeys.has(key) ? null : cellOf.get(key) ?? null,
        active: activeByKey.has(key) ? activeByKey.get(key)! : null,
        color: SDR_PALETTE[i % SDR_PALETTE.length],
      }));

    const body: BaseResponse = {
      months,
      today,
      leaders,
      sdrs,
      clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name, "es")),
      goals,
      meetings,
      oppValues: [...oppValues].sort(),
      incomplete: { pastPending: pastPendingRes.count ?? 0, invalidDates: invalidRes.count ?? 0 },
      warnings,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("Error en /api/celulas-sdr/base:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
