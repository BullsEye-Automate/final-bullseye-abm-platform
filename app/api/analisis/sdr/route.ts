import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import {
  isConnected,
  toDateParam,
  endOfDayUTC,
  resolveMeetingsRangeEnd,
  callDateKey,
  resolveSdrKey,
  isRealizadoSi,
  isRealizadoPendiente,
} from "@/lib/sdrAnalytics";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  contactos_gestionados: number;
  llamadas_realizadas: number;
  contactos_conectados: number;
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
  fecha_agendamiento?: string;
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

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    // sdr_ids: lista separada por comas (selector multi-select). Se acepta
    // también sdr_id (singular) por compatibilidad.
    const sdrIdsParam = request.nextUrl.searchParams.get("sdr_ids") || request.nextUrl.searchParams.get("sdr_id");
    const selectedSdrIds = sdrIdsParam ? sdrIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const rangeKeyRaw = request.nextUrl.searchParams.get("rangeKey") || "mes";
    const customFromParam = request.nextUrl.searchParams.get("custom_from");
    const customToParam = request.nextUrl.searchParams.get("custom_to");

    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    const db = supabaseAdmin();
    const isAllClients = clientId === "__all__";
    const isValidDateParam = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

    // "last_3_months"/"last_6_months" son rangos propios de este módulo (no
    // viven en lib/dashboardRanges.ts para no agregar opciones en los demás
    // filtros de la app que comparten ese archivo). Incluyen el mes en curso
    // (en progreso) + los meses cerrados anteriores hasta completar N meses.
    const LAST_N_MONTHS: Record<string, number> = { last_3_months: 3, last_6_months: 6 };
    const isLastNMonths = rangeKeyRaw in LAST_N_MONTHS;

    let effectiveRangeKey: RangeKey = "this_month";
    let range: { start: Date; end: Date; label: string; previous: { start: Date; end: Date } };

    if (isLastNMonths) {
      const n = LAST_N_MONTHS[rangeKeyRaw];
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const start = new Date(Date.UTC(y, m - (n - 1), 1));
      const end = endOfDayUTC(now);
      range = {
        start,
        end,
        label: rangeKeyRaw === "last_3_months" ? "Últimos 3 meses" : "Últimos 6 meses",
        previous: { start, end },
      };
    } else {
      effectiveRangeKey = isValidRangeKey(rangeKeyRaw) ? rangeKeyRaw : "this_month";
      range = resolveRange(effectiveRangeKey);
      if (effectiveRangeKey === "custom" && isValidDateParam(customFromParam) && isValidDateParam(customToParam)) {
        range = {
          start: new Date(`${customFromParam}T00:00:00.000Z`),
          end: new Date(`${customToParam}T23:59:59.999Z`),
          label: "Fecha personalizada",
          previous: range.previous,
        };
      }
    }

    const dateFrom = toDateParam(range.start);
    const dateTo = toDateParam(range.end);
    // Para "últimos N meses" el rango termina en el mes en curso, así que
    // igual que "this_month" hay que extender hasta fin de ese mes para
    // capturar reuniones Pendientes agendadas a futuro dentro de él.
    const meetingsRangeEnd = isLastNMonths
      ? endOfDayUTC(new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth() + 1, 0)))
      : resolveMeetingsRangeEnd(effectiveRangeKey, range.end, new Date());
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
    //
    // El gráfico "Resultados SDR" distingue Agendadas (por fecha_agendamiento,
    // cuándo se agendó la reunión) de Realizadas (por fecha_reunion, cuándo
    // efectivamente ocurrió/ocurrirá) — dos fechas distintas de la misma fila.
    // Por eso el query trae filas que calcen por CUALQUIERA de las dos fechas
    // dentro del período; el gráfico bucketiza cada métrica con su propio
    // campo más abajo. El Ranking SDR, en cambio, define "Agendadas" como el
    // total de reuniones con fecha_reunion en el período (ver
    // meetingsForRanking) — confirmado con BullsEye contra el reporte
    // interno, es un criterio distinto al del gráfico a propósito.
    // PostgREST limita cada respuesta a 1000 filas por defecto. Un rango de
    // varios meses para "todos los clientes" (ej. "Últimos 6 meses") supera
    // fácilmente ese límite, y sin un .order() explícito el corte de filas
    // no tiene un orden garantizado — eso hacía que reuniones recién
    // sincronizadas quedaran fuera de la respuesta según qué tan grande fuera
    // el período consultado (mismo mes, datos distintos según el rango
    // elegido). Se pagina con .range() hasta traer todas las filas.
    const MEETINGS_PAGE_SIZE = 1000;
    const meetings: any[] = [];
    let meetingsError: { message: string } | null = null;
    for (let offset = 0; ; offset += MEETINGS_PAGE_SIZE) {
      let meetingsQuery = db
        .from("meetings")
        .select("id, sdr_nombre, responsable, fecha_reunion, fecha_agendamiento, realizado, contacto_nombre, empresa, client_id")
        .or(
          `and(fecha_reunion.gte.${dateFrom},fecha_reunion.lte.${meetingsDateTo}),` +
            `and(fecha_agendamiento.gte.${dateFrom},fecha_agendamiento.lte.${meetingsDateTo})`
        )
        .order("id", { ascending: true })
        .range(offset, offset + MEETINGS_PAGE_SIZE - 1);

      if (!isAllClients) {
        meetingsQuery = meetingsQuery.eq("client_id", clientId);
      }

      const { data: page, error: pageError } = await meetingsQuery;

      if (pageError) {
        meetingsError = pageError;
        break;
      }

      meetings.push(...(page || []));
      if (!page || page.length < MEETINGS_PAGE_SIZE) break;
    }

    if (meetingsError) {
      return NextResponse.json({ error: meetingsError.message }, { status: 500 });
    }

    // Subconjunto usado por el Ranking SDR (meetingsBySDR más abajo):
    // reuniones cuya fecha_reunion cae en el período. A diferencia del
    // gráfico "Resultados SDR" (que separa Agendadas por fecha_agendamiento
    // de Realizadas por fecha_reunion), el Ranking define "Agendadas" como
    // el total de reuniones con fecha_reunion en el período, sin importar
    // su estado — así lo confirmó BullsEye contra el reporte interno.
    const meetingsForRanking = (meetings || []).filter(
      (m: any) => m.fecha_reunion >= dateFrom && m.fecha_reunion <= meetingsDateTo
    );

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
          contactos_gestionados: 0,
          llamadas_realizadas: 0,
          contactos_conectados: 0,
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

    for (const meeting of meetingsForRanking) {
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
      if (isRealizadoSi(meeting.realizado)) {
        meetingsBySDR[sdrKey].realizadas++;
      } else if (isRealizadoPendiente(meeting.realizado)) {
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
        const sdrCalls = calls.filter((c) => (c.user?.id || "unknown") === sdrId);
        const contactosUnicos = new Set(sdrCalls.map((c) => c.contact_number)).size;
        const contactosConectados = new Set(
          sdrCalls.filter((c) => isConnected(c.duration, c.result)).map((c) => c.contact_number)
        ).size;
        sdrData.contactos_gestionados = contactosUnicos;
        sdrData.contactos_conectados = contactosConectados;
        sdrData.tasa_conectadas_por_contacto =
          contactosUnicos > 0 ? (sdrData.llamadas_conectadas / contactosUnicos) * 100 : 0;
      }

      if (sdrData.reuniones_agendadas > 0) {
        sdrData.tasa_agendada_por_conectada =
          sdrData.contactos_conectados > 0
            ? (sdrData.reuniones_agendadas / sdrData.contactos_conectados) * 100
            : 0;
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
        contactos_gestionados: 0,
        llamadas_realizadas: 0,
        contactos_conectados: 0,
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
      // Agendadas: por fecha_agendamiento (cuándo se agendó). Realizadas:
      // por fecha_reunion (cuándo ocurrió efectivamente) + realizado="Si".
      // Son dos fechas distintas de la misma tabla, a propósito.
      let dayMeetingsAgendadas = (meetings || []).filter((m: any) => m.fecha_agendamiento === dateStr);
      let dayMeetingsRealizadas = (meetings || []).filter(
        (m: any) => m.fecha_reunion === dateStr && isRealizadoSi(m.realizado)
      );

      if (selectedSdrIds.length > 0) {
        dayCalls = dayCalls.filter((c) => selectedSdrIds.includes(c.user?.id || "unknown"));
        const bySelectedSdr = (m: any) =>
          selectedMeetingKeys.has(resolveSdrKey(m.responsable || m.sdr_nombre || "Sin SDR"));
        dayMeetingsAgendadas = dayMeetingsAgendadas.filter(bySelectedSdr);
        dayMeetingsRealizadas = dayMeetingsRealizadas.filter(bySelectedSdr);
      }

      resultadosPorDia.push({
        fecha: dateStr,
        llamadas_realizadas: dayCalls.length,
        reuniones_agendadas: dayMeetingsAgendadas.length,
        reuniones_realizadas: dayMeetingsRealizadas.length,
        reuniones: dayMeetingsAgendadas.map((m: any) => ({
          id: m.id,
          sdr_nombre: m.responsable || m.sdr_nombre,
          fecha_reunion: m.fecha_reunion,
          fecha_agendamiento: m.fecha_agendamiento,
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
