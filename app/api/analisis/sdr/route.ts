import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
};

type Reunion = {
  id: string;
  sdr_nombre: string;
  fecha_reunion: string;
  prospecto_nombre?: string;
  empresa?: string;
  client_id?: string;
};

type ResultadosDia = {
  fecha: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones?: Reunion[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const MIN_REAL_CONVERSATION_SECONDS = 60;

function isConnected(duration: number, result: string | null): boolean {
  return (result === "ANSWERED" || result === "TRANSFERRED") && duration >= MIN_REAL_CONVERSATION_SECONDS;
}

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// call.date de Allo es un timestamp ISO completo (con hora), no "YYYY-MM-DD"
function callDateKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

// Normaliza nombres de SDR para poder emparejar el usuario de Allo (llamadas)
// con el nombre cargado manualmente en el Excel de reuniones (meetings.sdr_nombre),
// que puede diferir en mayúsculas, tildes o espacios.
function normalizeSdrName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const sdrIdParam = request.nextUrl.searchParams.get("sdr_id");
    const rangeKey = (request.nextUrl.searchParams.get("rangeKey") || "mes") as RangeKey;

    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    const db = supabaseAdmin();
    const isAllClients = clientId === "__all__";
    const range = isValidRangeKey(rangeKey) ? resolveRange(rangeKey) : resolveRange("this_month");
    const dateFrom = toDateParam(range.start);
    const dateTo = toDateParam(range.end);

    // Obtener números de Allo asignados al cliente
    let assignedQuery = db.from("client_allo_numbers").select("allo_number");
    if (!isAllClients) {
      assignedQuery = assignedQuery.eq("client_id", clientId);
    }
    const { data: assigned, error: assignedErr } = await assignedQuery;

    if (assignedErr) {
      return NextResponse.json({ error: assignedErr.message }, { status: 500 });
    }

    const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);

    if (assignedNumbers.length === 0) {
      return NextResponse.json({
        sdrs_data: [],
        resultados_por_dia: [],
      });
    }

    // Obtener llamadas desde Allo
    const [callsByNumber, allNumbers] = await Promise.all([
      Promise.all(
        assignedNumbers.map((n) =>
          searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
        )
      ),
      listAlloNumbers(),
    ]);

    const calls = callsByNumber.flat();

    // Mapear IDs de usuarios de Allo
    const userMap = new Map<string, string>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      for (const u of n.users) {
        userMap.set(u.id, u.name);
      }
    }

    // Obtener reuniones desde Supabase.
    // El SDR se identifica con "responsable" (columna "Responsable de la
    // reunión" del Google Sheet, llenada por el sync automático en
    // lib/syncMeetings.ts). "sdr_nombre" solo se llena en la importación
    // manual de CSV (app/api/meetings/import) y suele venir vacío para las
    // reuniones sincronizadas desde el Excel.
    let meetingsQuery = db
      .from("meetings")
      .select("id, sdr_nombre, responsable, fecha_reunion, realizado, contacto_nombre, empresa, client_id")
      .gte("fecha_reunion", dateFrom)
      .lt("fecha_reunion", dateTo);

    if (!isAllClients) {
      meetingsQuery = meetingsQuery.eq("client_id", clientId);
    }

    const { data: meetings, error: meetingsError } = await meetingsQuery;

    if (meetingsError) {
      return NextResponse.json({ error: meetingsError.message }, { status: 500 });
    }

    // Obtener nombres de clientes para mapeo
    let clientsData: any[] = [];
    if (meetings && meetings.length > 0) {
      const clientIds = [...new Set(meetings.map((m: any) => m.client_id))];
      const { data: clients, error: clientsError } = await db
        .from("clients")
        .select("id, name")
        .in("id", clientIds);

      if (clientsError) {
        console.error("Error obteniendo clientes:", clientsError);
      }
      clientsData = clients || [];
    }

    const clientMap = new Map(clientsData.map((c: any) => [c.id, c.name]));

    // Agrupar datos por SDR
    const sdrDataMap: Record<string, SdrMetrics> = {};

    // Procesar llamadas
    for (const call of calls) {
      const sdrId = call.user?.id || "unknown";
      const sdrName = userMap.get(sdrId) || call.user?.name || sdrId;

      if (!sdrDataMap[sdrId]) {
        sdrDataMap[sdrId] = {
          sdr_id: sdrId,
          sdr_nombre: sdrName,
          llamadas_realizadas: 0,
          reuniones_agendadas: 0,
          reuniones_realizadas: 0,
          tasa_conectadas_por_contacto: 0,
          tasa_agendada_por_conectada: 0,
          tasa_realizacion_reuniones: 0,
        };
      }

      sdrDataMap[sdrId].llamadas_realizadas++;
    }

    // Procesar reuniones (se indexan por nombre normalizado para poder
    // emparejar con el nombre del usuario de Allo aunque difieran en
    // mayúsculas, tildes o espacios)
    const meetingsBySDR: Record<string, { agendadas: number; realizadas: number; contactos: Set<string> }> = {};

    for (const meeting of meetings || []) {
      const sdrKey = normalizeSdrName(meeting.responsable || meeting.sdr_nombre || "Sin SDR");
      if (!meetingsBySDR[sdrKey]) {
        meetingsBySDR[sdrKey] = {
          agendadas: 0,
          realizadas: 0,
          contactos: new Set(),
        };
      }
      meetingsBySDR[sdrKey].agendadas++;
      if (meeting.realizado === "Si") {
        meetingsBySDR[sdrKey].realizadas++;
      }
    }

    // Calcular métricas consolidadas
    const sdrsData: SdrMetrics[] = [];
    const processedSdrIds = new Set<string>();

    for (const sdrId in sdrDataMap) {
      const sdrData = sdrDataMap[sdrId];
      processedSdrIds.add(sdrId);

      const meetingData = meetingsBySDR[normalizeSdrName(sdrData.sdr_nombre)];
      if (meetingData) {
        sdrData.reuniones_agendadas = meetingData.agendadas;
        sdrData.reuniones_realizadas = meetingData.realizadas;
      }

      // Calcular tasas
      if (sdrData.llamadas_realizadas > 0) {
        const conectadas = calls.filter(
          (c) => (c.user?.id || "unknown") === sdrId && isConnected(c.duration, c.result)
        ).length;
        const contactosUnicos = new Set(
          calls.filter((c) => (c.user?.id || "unknown") === sdrId).map((c) => c.contact_number)
        ).size;
        sdrData.tasa_conectadas_por_contacto =
          contactosUnicos > 0 ? (conectadas / contactosUnicos) * 100 : 0;
      }

      if (sdrData.reuniones_agendadas > 0) {
        sdrData.tasa_agendada_por_conectada =
          sdrData.llamadas_realizadas > 0 ? (sdrData.reuniones_agendadas / sdrData.llamadas_realizadas) * 100 : 0;
        sdrData.tasa_realizacion_reuniones = (sdrData.reuniones_realizadas / sdrData.reuniones_agendadas) * 100;
      }

      // Filtrar si se solicita un SDR específico
      if (!sdrIdParam || sdrId === sdrIdParam) {
        sdrsData.push(sdrData);
      }
    }

    // Construir resultados por día
    const resultadosPorDia: ResultadosDia[] = [];
    const currentDate = new Date(range.start);
    while (currentDate < range.end) {
      const dateStr = toDateParam(currentDate);
      const dayCalls = calls.filter((c) => callDateKey(c.date) === dateStr);
      const dayMeetings = (meetings || []).filter((m) => m.fecha_reunion === dateStr);

      resultadosPorDia.push({
        fecha: dateStr,
        llamadas_realizadas: dayCalls.length,
        reuniones_agendadas: dayMeetings.length,
        reuniones_realizadas: dayMeetings.filter((m) => m.realizado === "Si").length,
        reuniones: dayMeetings.map((m: any) => ({
          id: m.id,
          sdr_nombre: m.responsable || m.sdr_nombre,
          fecha_reunion: m.fecha_reunion,
          prospecto_nombre: m.contacto_nombre,
          empresa: m.empresa,
          client_id: m.client_id,
          client_name: clientMap.get(m.client_id) || "Sin cliente",
        })),
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return NextResponse.json({
      sdrs_data: sdrsData.sort((a, b) => b.llamadas_realizadas - a.llamadas_realizadas),
      resultados_por_dia: resultadosPorDia,
    });
  } catch (err) {
    console.error("Error en /api/analisis/sdr:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
