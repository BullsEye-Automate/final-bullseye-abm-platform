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
  isRealizadoSi,
  isRealizadoPendiente,
} from "@/lib/sdrAnalytics";
import { toChileParts } from "@/lib/timezone";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────
// Mismo reporte que /api/analisis/sdr (Resultados SDR + Ranking SDR), pero
// agrupado por cliente en vez de por SDR. A diferencia del SDR (que hay que
// emparejar por nombre entre Allo y el Excel de reuniones), el cliente ya es
// un id limpio en ambas fuentes (client_allo_numbers.client_id para
// llamadas, meetings.client_id para reuniones) — no hace falta resolución
// difusa de nombres ni un caso "meeting-only" con clave sintética.

type ClienteMetrics = {
  cliente_id: string;
  cliente_nombre: string;
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
  client_name?: string;
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
    // cliente_ids: lista de client_id separada por comas (selector
    // multi-select) — filtra tanto el gráfico "Resultados Clientes" como el
    // "Ranking Clientes".
    const clienteIdsParam = request.nextUrl.searchParams.get("cliente_ids");
    const selectedClienteIds = clienteIdsParam
      ? clienteIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const rangeKeyRaw = request.nextUrl.searchParams.get("rangeKey") || "this_month";
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
      // Se traslada a horario de Chile antes de leer año/mes — mismo
      // criterio que dashboardRanges.resolveRange (ver lib/timezone.ts).
      const now = toChileParts(new Date());
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
    const meetingsRangeEnd = isLastNMonths
      ? endOfDayUTC(new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth() + 1, 0)))
      : resolveMeetingsRangeEnd(effectiveRangeKey, range.end, new Date());
    const meetingsDateTo = toDateParam(meetingsRangeEnd);

    // Números de Allo asignados (con su client_id — cada número pertenece a
    // un único cliente, hay un índice único sobre allo_number)
    let assignedQuery = db.from("client_allo_numbers").select("allo_number, client_id");
    if (!isAllClients) {
      assignedQuery = assignedQuery.eq("client_id", clientId);
    }
    const { data: assigned, error: assignedErr } = await assignedQuery;

    if (assignedErr) {
      return NextResponse.json({ error: assignedErr.message }, { status: 500 });
    }

    const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);
    const numberClientMap = new Map<string, string>();
    for (const r of assigned ?? []) {
      numberClientMap.set(r.allo_number, r.client_id);
    }

    if (assignedNumbers.length === 0) {
      return NextResponse.json({
        clientes_data: [],
        resultados_por_dia: [],
        all_clientes: [],
      });
    }

    // Obtener llamadas desde Allo
    const [callsByNumber] = await Promise.all([
      Promise.all(
        assignedNumbers.map((n) =>
          searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
        )
      ),
      listAlloNumbers(),
    ]);

    // Filtros locales de respaldo (ver /api/analisis/sdr/route.ts para el
    // detalle de cada uno): fecha, número asignado, duplicados.
    const seenCallIds = new Set<string>();
    const calls = callsByNumber.flat().filter((c) => {
      if (!assignedNumbers.includes(c.allo_number)) return false;
      const key = callDateKey(c.date);
      if (key < dateFrom || key > dateTo) return false;
      if (seenCallIds.has(c.id)) return false;
      seenCallIds.add(c.id);
      return true;
    });

    // Reuniones: se trae toda fila que calce por fecha_reunion O por
    // fecha_agendamiento dentro del período (igual que /api/analisis/sdr) —
    // "Reuniones Agendadas/Realizadas/Pendientes" cuentan por fecha_reunion,
    // fecha_agendamiento solo se usa para el numerador de "Tasa
    // Agendada/Conectada". Paginado para no toparse con el límite de 1000
    // filas de PostgREST.
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

    // Nombres de cliente (para mostrar y para el roster del filtro)
    const allClientIdsSeen = new Set<string>([
      ...numberClientMap.values(),
      ...meetings.map((m: any) => m.client_id).filter(Boolean),
    ]);
    let clientMap = new Map<string, string>();
    if (allClientIdsSeen.size > 0) {
      const { data: clientRows, error: clientsErr } = await db
        .from("clients")
        .select("id, name")
        .in("id", [...allClientIdsSeen]);
      if (clientsErr) {
        console.error("Error obteniendo clientes:", clientsErr);
      }
      clientMap = new Map((clientRows || []).map((c: any) => [c.id, c.name]));
    }

    // Roster completo de clientes disponibles para el filtro (sin acotar
    // por selectedClienteIds, para que el selector no se achique una vez
    // que ya hay uno o más clientes elegidos).
    const allClientesRoster = [...allClientIdsSeen]
      .map((id) => ({ cliente_id: id, cliente_nombre: clientMap.get(id) || "Cliente desconocido" }))
      .sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre));

    // Filtro de cliente: acota tanto llamadas como reuniones a los clientes
    // seleccionados. Se usa tanto para el Ranking Clientes como para el
    // gráfico "Resultados Clientes" (reemplaza al filtro de SDR).
    const callClientId = (c: any) => numberClientMap.get(c.allo_number) || "";
    const filteredCalls =
      selectedClienteIds.length > 0 ? calls.filter((c) => selectedClienteIds.includes(callClientId(c))) : calls;
    const bySelectedCliente = (m: any) =>
      selectedClienteIds.length === 0 || selectedClienteIds.includes(m.client_id);

    // "Reuniones Realizadas/Pendientes" cuentan por fecha_reunion en el
    // período (igual que Ranking SDR) — meetingsForRanking. La columna
    // "Reuniones Agendadas" que se muestra usa fecha_agendamiento
    // (meetingsAgendadasEnPeriodo), y ese mismo conteo es también el
    // numerador de "Tasa Agendada/Conectada".
    const meetingsForRanking = meetings.filter(
      (m: any) => m.fecha_reunion >= dateFrom && m.fecha_reunion <= meetingsDateTo && bySelectedCliente(m)
    );
    const meetingsAgendadasEnPeriodo = meetings.filter(
      (m: any) =>
        m.fecha_agendamiento >= dateFrom && m.fecha_agendamiento <= meetingsDateTo && bySelectedCliente(m)
    );

    // Agrupar por cliente
    const clientDataMap: Record<
      string,
      {
        llamadas_realizadas: number;
        llamadas_conectadas: number;
        contactos: Set<string>;
        contactosConectados: Set<string>;
        agendadas: number;
        agendadasEnPeriodo: number;
        realizadas: number;
        pendientes: number;
      }
    > = {};

    const getBucket = (cid: string) => {
      if (!clientDataMap[cid]) {
        clientDataMap[cid] = {
          llamadas_realizadas: 0,
          llamadas_conectadas: 0,
          contactos: new Set(),
          contactosConectados: new Set(),
          agendadas: 0,
          agendadasEnPeriodo: 0,
          realizadas: 0,
          pendientes: 0,
        };
      }
      return clientDataMap[cid];
    };

    for (const call of filteredCalls) {
      const cid = callClientId(call);
      if (!cid) continue;
      const bucket = getBucket(cid);
      bucket.llamadas_realizadas++;
      bucket.contactos.add(call.contact_number);
      if (isConnected(call.duration, call.result)) {
        bucket.llamadas_conectadas++;
        bucket.contactosConectados.add(call.contact_number);
      }
    }

    for (const m of meetingsForRanking) {
      if (!m.client_id) continue;
      const bucket = getBucket(m.client_id);
      bucket.agendadas++;
      if (isRealizadoSi(m.realizado)) {
        bucket.realizadas++;
      } else if (isRealizadoPendiente(m.realizado)) {
        bucket.pendientes++;
      }
    }

    for (const m of meetingsAgendadasEnPeriodo) {
      if (!m.client_id) continue;
      getBucket(m.client_id).agendadasEnPeriodo++;
    }

    const clientesData: ClienteMetrics[] = Object.entries(clientDataMap).map(([cid, d]) => ({
      cliente_id: cid,
      cliente_nombre: clientMap.get(cid) || "Cliente desconocido",
      contactos_gestionados: d.contactos.size,
      llamadas_realizadas: d.llamadas_realizadas,
      contactos_conectados: d.contactosConectados.size,
      llamadas_conectadas: d.llamadas_conectadas,
      // Por fecha_agendamiento (cuándo se agendó la reunión), no por
      // fecha_reunion — mismo criterio que Ranking SDR, para responder
      // "cuántas reuniones agendó el equipo en este período" en vez de
      // "cuántas reuniones con fecha en este período hay" (d.agendadas
      // sigue siendo por fecha_reunion, se usa solo como denominador de
      // Tasa Realización más abajo).
      reuniones_agendadas: d.agendadasEnPeriodo,
      reuniones_realizadas: d.realizadas,
      reuniones_pendientes: d.pendientes,
      tasa_conectadas_por_contacto:
        d.contactos.size > 0 ? (d.contactosConectados.size / d.contactos.size) * 100 : 0,
      tasa_agendada_por_conectada:
        d.contactosConectados.size > 0 ? (d.agendadasEnPeriodo / d.contactosConectados.size) * 100 : 0,
      tasa_realizacion_reuniones: d.agendadas > 0 ? (d.realizadas / d.agendadas) * 100 : 0,
    }));

    // Construir resultados por día para el gráfico "Resultados Clientes".
    // Se extiende hasta meetingsRangeEnd (no solo range.end) para que las
    // reuniones Pendientes agendadas para fechas futuras dentro del período
    // también aparezcan.
    const resultadosPorDia: ResultadosDia[] = [];
    const loopEnd = meetingsRangeEnd.getTime() > range.end.getTime() ? meetingsRangeEnd : range.end;
    const currentDate = new Date(range.start);
    while (currentDate < loopEnd) {
      const dateStr = toDateParam(currentDate);
      const dayCalls = filteredCalls.filter((c) => callDateKey(c.date) === dateStr);
      // Agendadas: por fecha_agendamiento. Realizadas: por fecha_reunion +
      // realizado="Si". Dos fechas distintas de la misma fila, a propósito
      // (igual que en /api/analisis/sdr).
      const dayMeetingsAgendadas = meetings.filter(
        (m: any) => m.fecha_agendamiento === dateStr && bySelectedCliente(m)
      );
      const dayMeetingsRealizadas = meetings.filter(
        (m: any) => m.fecha_reunion === dateStr && isRealizadoSi(m.realizado) && bySelectedCliente(m)
      );

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
      clientes_data: clientesData.sort((a, b) => b.llamadas_realizadas - a.llamadas_realizadas),
      resultados_por_dia: resultadosPorDia,
      all_clientes: allClientesRoster,
    });
  } catch (err) {
    console.error("Error en /api/analisis/clientes:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
