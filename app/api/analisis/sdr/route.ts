import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";

// dashboardRanges.resolveRange corta los rangos "this_*" (en curso) en el
// día de hoy — correcto para "llamadas realizadas" (no puede haber llamadas
// futuras), pero incorrecto para "reuniones agendadas": una reunión
// Pendiente puede estar agendada para un día futuro dentro del mismo
// período (ej. agendada para el 30 si hoy es 26), y quedaba excluida.
// Esta función calcula el fin real del período (sin cortar en "hoy") para
// usarlo solo en la consulta de reuniones.
function endOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function resolveMeetingsRangeEnd(rangeKey: RangeKey, fallbackEnd: Date, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  switch (rangeKey) {
    case "this_week": {
      const day = now.getUTCDay();
      const daysUntilSunday = day === 0 ? 0 : 7 - day;
      return endOfDayUTC(new Date(Date.UTC(y, m, now.getUTCDate() + daysUntilSunday)));
    }
    case "this_month":
      return endOfDayUTC(new Date(Date.UTC(y, m + 1, 0)));
    case "this_quarter": {
      const qStartMonth = Math.floor(m / 3) * 3;
      return endOfDayUTC(new Date(Date.UTC(y, qStartMonth + 3, 0)));
    }
    case "this_semester":
      return endOfDayUTC(new Date(Date.UTC(y, m < 6 ? 6 : 12, 0)));
    case "this_year":
      return endOfDayUTC(new Date(Date.UTC(y, 12, 0)));
    default:
      // "today", "last_*" y "custom" ya representan un período completo
      return fallbackEnd;
  }
}

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  llamadas_conectadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
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

// call.date de Allo es un timestamp ISO completo en UTC, no "YYYY-MM-DD".
// Los rangos de fecha (dateFrom/dateTo) representan días calendario del
// negocio, que opera en horario de Chile (UTC-4, sin horario de verano
// desde 2019) — no UTC. Sin este ajuste, llamadas hechas entre las 20:00 y
// medianoche hora Chile caen, en UTC, dentro del día calendario siguiente,
// y quedaban excluidas del día correcto (se detectó comparando 'Ayer' con
// el dashboard de Allo: la app contaba menos llamadas que Allo).
// NOTA: asume horario de Chile para todos los números — si en el futuro
// se opera con clientes en otro país, esto debe volverse por número
// (AlloNumber.country) en vez de un offset fijo.
const CHILE_UTC_OFFSET_HOURS = -4;
function callDateKey(isoDate: string): string {
  const shifted = new Date(new Date(isoDate).getTime() + CHILE_UTC_OFFSET_HOURS * 3600000);
  return shifted.toISOString().slice(0, 10);
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

// Alias manuales para nombres que no calzan ni normalizando (apodos, solo
// nombre de pila, faltas de ortografía en el Excel, etc.). Clave = nombre tal
// como aparece en meetings.responsable / sdr_nombre (normalizado), valor =
// nombre tal como está registrado en Allo (normalizado). Cuando un SDR nuevo
// no calce, se agrega acá una línea más — confirmado con BullsEye caso a caso.
const SDR_NAME_ALIASES: Record<string, string> = {
  [normalizeSdrName("Jacqueline Fuentes")]: normalizeSdrName("Jaqueline Fuentes"),
  [normalizeSdrName("María José")]:         normalizeSdrName("María José Espinoza"),
  [normalizeSdrName("Pedro")]:              normalizeSdrName("Pedro Gallardo"),
};

function resolveSdrKey(name: string): string {
  const normalized = normalizeSdrName(name);
  return SDR_NAME_ALIASES[normalized] || normalized;
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    // sdr_ids: lista separada por comas (selector multi-select). Se acepta
    // también sdr_id (singular) por compatibilidad.
    const sdrIdsParam = request.nextUrl.searchParams.get("sdr_ids") || request.nextUrl.searchParams.get("sdr_id");
    const selectedSdrIds = sdrIdsParam ? sdrIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const rangeKey = (request.nextUrl.searchParams.get("rangeKey") || "mes") as RangeKey;
    const customFromParam = request.nextUrl.searchParams.get("custom_from");
    const customToParam = request.nextUrl.searchParams.get("custom_to");

    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    const db = supabaseAdmin();
    const isAllClients = clientId === "__all__";
    const effectiveRangeKey: RangeKey = isValidRangeKey(rangeKey) ? rangeKey : "this_month";
    const isValidDateParam = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

    let range = resolveRange(effectiveRangeKey);
    if (effectiveRangeKey === "custom" && isValidDateParam(customFromParam) && isValidDateParam(customToParam)) {
      range = {
        start: new Date(`${customFromParam}T00:00:00.000Z`),
        end: new Date(`${customToParam}T23:59:59.999Z`),
        label: "Fecha personalizada",
        previous: range.previous,
      };
    }

    const dateFrom = toDateParam(range.start);
    const dateTo = toDateParam(range.end);
    const meetingsRangeEnd = resolveMeetingsRangeEnd(effectiveRangeKey, range.end, new Date());
    const meetingsDateTo = toDateParam(meetingsRangeEnd);

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

    // Filtros locales de respaldo, sin depender de que la API de Allo filtre
    // bien de su lado:
    // 1. Fecha: cuando dateFrom === dateTo (rango "Hoy"), Allo parece no
    //    aplicar el filtro de fecha y devuelve resultados fuera de rango
    //    (se observó: "Hoy" mostraba los mismos totales que "Este mes").
    // 2. Número: se observaron totales muy por encima de los que muestra el
    //    propio dashboard de Allo al sumar por varios números — es posible
    //    que el filtro allo_number tampoco se aplique siempre de forma
    //    estricta. Se descarta cualquier llamada cuyo allo_number no sea
    //    exactamente uno de los asignados.
    // 3. Duplicados: se deduplica por id — si Allo devuelve la misma llamada
    //    en más de una consulta por número, no debe contarse dos veces.
    const seenCallIds = new Set<string>();
    const calls = callsByNumber.flat().filter((c) => {
      if (!assignedNumbers.includes(c.allo_number)) return false;
      const key = callDateKey(c.date);
      if (key < dateFrom || key > dateTo) return false;
      if (seenCallIds.has(c.id)) return false;
      seenCallIds.add(c.id);
      return true;
    });

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
    // Límite superior inclusivo (.lte) hasta meetingsDateTo: usar .lt con la
    // fecha de hoy excluía las reuniones agendadas para el día de hoy mismo.
    let meetingsQuery = db
      .from("meetings")
      .select("id, sdr_nombre, responsable, fecha_reunion, realizado, contacto_nombre, empresa, client_id")
      .gte("fecha_reunion", dateFrom)
      .lte("fecha_reunion", meetingsDateTo);

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
          llamadas_conectadas: 0,
          reuniones_agendadas: 0,
          reuniones_realizadas: 0,
          reuniones_pendientes: 0,
          tasa_conectadas_por_contacto: 0,
          tasa_agendada_por_conectada: 0,
          tasa_realizacion_reuniones: 0,
        };
      }

      sdrDataMap[sdrId].llamadas_realizadas++;
      if (isConnected(call.duration, call.result)) {
        sdrDataMap[sdrId].llamadas_conectadas++;
      }
    }

    // Procesar reuniones (se indexan por nombre normalizado para poder
    // emparejar con el nombre del usuario de Allo aunque difieran en
    // mayúsculas, tildes o espacios). Se guarda también el nombre "display"
    // original, porque un responsable de reuniones puede no tener llamadas
    // registradas en el período (o nunca marcar), y en ese caso no hay
    // ningún sdrData ya creado del que tomar el nombre para mostrar.
    const meetingsBySDR: Record<
      string,
      { displayName: string; agendadas: number; realizadas: number; pendientes: number; contactos: Set<string> }
    > = {};

    for (const meeting of meetings || []) {
      const rawName = meeting.responsable || meeting.sdr_nombre || "Sin SDR";
      const sdrKey = resolveSdrKey(rawName);
      if (!meetingsBySDR[sdrKey]) {
        meetingsBySDR[sdrKey] = {
          displayName: rawName,
          agendadas: 0,
          realizadas: 0,
          pendientes: 0,
          contactos: new Set(),
        };
      }
      meetingsBySDR[sdrKey].agendadas++;
      if (meeting.realizado === "Si") {
        meetingsBySDR[sdrKey].realizadas++;
      } else if (meeting.realizado === "Pendiente") {
        meetingsBySDR[sdrKey].pendientes++;
      }
    }

    // Calcular métricas consolidadas
    const sdrsData: SdrMetrics[] = [];
    const processedSdrIds = new Set<string>();
    const claimedMeetingKeys = new Set<string>();
    // Roster completo de SDRs (sin filtrar por selectedSdrIds), para que el
    // selector de SDR del frontend siempre pueda mostrar y elegir entre
    // todos, incluso cuando ya hay uno o más seleccionados.
    const allSdrsRoster: { sdr_id: string; sdr_nombre: string }[] = [];

    for (const sdrId in sdrDataMap) {
      const sdrData = sdrDataMap[sdrId];
      processedSdrIds.add(sdrId);

      const meetingKey = resolveSdrKey(sdrData.sdr_nombre);
      const meetingData = meetingsBySDR[meetingKey];
      if (meetingData) {
        claimedMeetingKeys.add(meetingKey);
        sdrData.reuniones_agendadas = meetingData.agendadas;
        sdrData.reuniones_pendientes = meetingData.pendientes;
        sdrData.reuniones_realizadas = meetingData.realizadas;
      }

      // Calcular tasas
      if (sdrData.llamadas_realizadas > 0) {
        const contactosUnicos = new Set(
          calls.filter((c) => (c.user?.id || "unknown") === sdrId).map((c) => c.contact_number)
        ).size;
        sdrData.tasa_conectadas_por_contacto =
          contactosUnicos > 0 ? (sdrData.llamadas_conectadas / contactosUnicos) * 100 : 0;
      }

      if (sdrData.reuniones_agendadas > 0) {
        sdrData.tasa_agendada_por_conectada =
          sdrData.llamadas_realizadas > 0 ? (sdrData.reuniones_agendadas / sdrData.llamadas_realizadas) * 100 : 0;
        sdrData.tasa_realizacion_reuniones = (sdrData.reuniones_realizadas / sdrData.reuniones_agendadas) * 100;
      }

      allSdrsRoster.push({ sdr_id: sdrId, sdr_nombre: sdrData.sdr_nombre });

      // Filtrar si se solicita un SDR específico
      if (selectedSdrIds.length === 0 || selectedSdrIds.includes(sdrId)) {
        sdrsData.push(sdrData);
      }
    }

    // Responsables de reuniones que no calzaron con ningún SDR de Allo (no
    // hicieron llamadas en el período, o su nombre no está en Allo — ej. un
    // Sales Manager que agenda pero no marca). Sin esto, sus reuniones se
    // perdían por completo del total: sdrDataMap solo se construye a partir
    // de llamadas, así que un responsable sin llamadas nunca generaba fila.
    for (const meetingKey in meetingsBySDR) {
      if (claimedMeetingKeys.has(meetingKey)) continue;
      const meetingData = meetingsBySDR[meetingKey];
      const sdrId = `meeting-only:${meetingKey}`;
      allSdrsRoster.push({ sdr_id: sdrId, sdr_nombre: meetingData.displayName });

      if (selectedSdrIds.length > 0 && !selectedSdrIds.includes(sdrId)) continue;

      const tasaRealizacion =
        meetingData.agendadas > 0 ? (meetingData.realizadas / meetingData.agendadas) * 100 : 0;

      sdrsData.push({
        sdr_id: sdrId,
        sdr_nombre: meetingData.displayName,
        llamadas_realizadas: 0,
        llamadas_conectadas: 0,
        reuniones_agendadas: meetingData.agendadas,
        reuniones_realizadas: meetingData.realizadas,
        reuniones_pendientes: meetingData.pendientes,
        tasa_conectadas_por_contacto: 0,
        tasa_agendada_por_conectada: 0,
        tasa_realizacion_reuniones: tasaRealizacion,
      });
    }

    // El filtro de SDR (selectedSdrIds) también debe aplicarse al gráfico
    // por día, no solo al Ranking — antes solo filtraba sdrsData, así que
    // el gráfico seguía mostrando el total de todo el equipo sin importar
    // qué SDR estuviera seleccionado. Para las llamadas se filtra por el id
    // de usuario de Allo; para las reuniones no hay un id de Allo (pueden
    // ser de un responsable "meeting-only"), así que se resuelve cada SDR
    // seleccionado a su meetingKey correspondiente.
    const selectedMeetingKeys = new Set<string>();
    for (const id of selectedSdrIds) {
      if (id.startsWith("meeting-only:")) {
        selectedMeetingKeys.add(id.slice("meeting-only:".length));
      } else if (sdrDataMap[id]) {
        selectedMeetingKeys.add(resolveSdrKey(sdrDataMap[id].sdr_nombre));
      }
    }

    // Construir resultados por día. Se extiende hasta meetingsRangeEnd (no
    // solo range.end) para que las reuniones Pendientes agendadas para
    // fechas futuras dentro del período también aparezcan en el gráfico.
    const resultadosPorDia: ResultadosDia[] = [];
    const loopEnd = meetingsRangeEnd.getTime() > range.end.getTime() ? meetingsRangeEnd : range.end;
    const currentDate = new Date(range.start);
    while (currentDate < loopEnd) {
      const dateStr = toDateParam(currentDate);
      let dayCalls = calls.filter((c) => callDateKey(c.date) === dateStr);
      let dayMeetings = (meetings || []).filter((m) => m.fecha_reunion === dateStr);

      if (selectedSdrIds.length > 0) {
        dayCalls = dayCalls.filter((c) => selectedSdrIds.includes(c.user?.id || "unknown"));
        dayMeetings = dayMeetings.filter((m: any) =>
          selectedMeetingKeys.has(resolveSdrKey(m.responsable || m.sdr_nombre || "Sin SDR"))
        );
      }

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
      all_sdrs: allSdrsRoster.sort((a, b) => a.sdr_nombre.localeCompare(b.sdr_nombre)),
    });
  } catch (err) {
    console.error("Error en /api/analisis/sdr:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
