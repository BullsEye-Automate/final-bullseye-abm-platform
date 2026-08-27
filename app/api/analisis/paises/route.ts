import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import {
  isConnected,
  toDateParam,
  resolveMeetingsRangeEnd,
  callDateKey,
  resolveSdrKey,
} from "@/lib/sdrAnalytics";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type PaisMetrics = {
  pais_key: string;
  pais_nombre: string;
  llamadas_realizadas: number;
  llamadas_conectadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  reuniones_pendientes: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

// Normaliza el nombre de país solo para agrupar (ej. "méxico" y "México" no
// deben caer en filas separadas). El nombre mostrado conserva tildes/casing
// originales — se guarda por separado la primera variante encontrada.
function normalizeCountryKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ─── GET ────────────────────────────────────────────────────────────────────
// Mismo reporte que /api/analisis/sdr (Ranking SDR), pero agrupado por país
// en vez de por SDR. Los filtros de SDR y fecha siguen aplicando sobre el
// mismo universo de llamadas/reuniones — solo cambia cómo se agrupan las
// filas resultantes.

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const sdrIdsParam = request.nextUrl.searchParams.get("sdr_ids") || request.nextUrl.searchParams.get("sdr_id");
    const selectedSdrIds = sdrIdsParam ? sdrIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const rangeKeyRaw = request.nextUrl.searchParams.get("rangeKey") || "this_month";
    const customFromParam = request.nextUrl.searchParams.get("custom_from");
    const customToParam = request.nextUrl.searchParams.get("custom_to");

    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    const db = supabaseAdmin();
    const isAllClients = clientId === "__all__";
    const isValidDateParam = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

    const effectiveRangeKey: RangeKey = isValidRangeKey(rangeKeyRaw) ? rangeKeyRaw : "this_month";
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

    // Números de Allo asignados al cliente
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
      return NextResponse.json({ paises_data: [], all_sdrs: [] });
    }

    const [callsByNumber, allNumbers] = await Promise.all([
      Promise.all(
        assignedNumbers.map((n) =>
          searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
        )
      ),
      listAlloNumbers(),
    ]);

    // Mismos filtros de respaldo que /api/analisis/sdr (ver ese archivo para
    // el detalle): descarta llamadas fuera de rango, de un número no
    // asignado, o duplicadas.
    const seenCallIds = new Set<string>();
    const calls = callsByNumber.flat().filter((c) => {
      if (!assignedNumbers.includes(c.allo_number)) return false;
      const key = callDateKey(c.date);
      if (key < dateFrom || key > dateTo) return false;
      if (seenCallIds.has(c.id)) return false;
      seenCallIds.add(c.id);
      return true;
    });

    // Mapear número Allo -> país. Se usa el campo "country" que entrega la
    // propia API de Allo y, si viene vacío, el nombre asignado al número en
    // Allo — los números están creados literalmente con el nombre del país
    // (ej. "Chile", "México"), así que sirve como respaldo confiable sin
    // tener que adivinar a partir del código de área.
    const numberCountryMap = new Map<string, string>();
    const userMap = new Map<string, string>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      const label = (n.country && n.country.trim()) || (n.name && n.name.trim()) || "Sin país";
      numberCountryMap.set(n.number, label);
      for (const u of n.users) {
        userMap.set(u.id, u.name);
      }
    }

    // Reuniones: mismo criterio que Ranking SDR (fecha_reunion dentro del
    // período — ver comentario en /api/analisis/sdr/route.ts), agregando la
    // columna "pais" (sincronizada desde el Excel de reuniones). Paginado
    // para no toparse con el límite de 1000 filas de PostgREST.
    const MEETINGS_PAGE_SIZE = 1000;
    const meetings: any[] = [];
    let meetingsError: { message: string } | null = null;
    for (let offset = 0; ; offset += MEETINGS_PAGE_SIZE) {
      let meetingsQuery = db
        .from("meetings")
        .select("id, sdr_nombre, responsable, fecha_reunion, realizado, pais, client_id")
        .gte("fecha_reunion", dateFrom)
        .lte("fecha_reunion", meetingsDateTo)
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

    // Roster de SDR para el filtro (mismo criterio que /api/analisis/sdr):
    // primero los que hicieron llamadas, luego responsables de reuniones sin
    // llamadas registradas en el período.
    const sdrRosterMap = new Map<string, string>(); // sdr_id (Allo) -> nombre
    for (const call of calls) {
      const sdrId = call.user?.id || "unknown";
      sdrRosterMap.set(sdrId, userMap.get(sdrId) || call.user?.name || sdrId);
    }
    const callSdrKeys = new Set([...sdrRosterMap.values()].map((name) => resolveSdrKey(name)));

    const meetingKeysSeen = new Map<string, string>(); // key -> displayName
    for (const m of meetings) {
      const rawName = m.responsable || m.sdr_nombre || "Sin SDR";
      const key = resolveSdrKey(rawName);
      if (!meetingKeysSeen.has(key)) meetingKeysSeen.set(key, rawName);
    }

    const allSdrsRoster: { sdr_id: string; sdr_nombre: string }[] = [
      ...[...sdrRosterMap.entries()].map(([sdr_id, sdr_nombre]) => ({ sdr_id, sdr_nombre })),
      ...[...meetingKeysSeen.entries()]
        .filter(([key]) => !callSdrKeys.has(key))
        .map(([key, displayName]) => ({ sdr_id: `meeting-only:${key}`, sdr_nombre: displayName })),
    ];

    // Resuelve selectedSdrIds a las claves de reuniones correspondientes
    // (mismo mecanismo que /api/analisis/sdr — un SDR seleccionado puede
    // venir como id de usuario de Allo o como "meeting-only:<key>").
    const selectedMeetingKeys = new Set<string>();
    for (const id of selectedSdrIds) {
      if (id.startsWith("meeting-only:")) {
        selectedMeetingKeys.add(id.slice("meeting-only:".length));
      } else if (sdrRosterMap.has(id)) {
        selectedMeetingKeys.add(resolveSdrKey(sdrRosterMap.get(id)!));
      }
    }

    const filteredCalls =
      selectedSdrIds.length > 0
        ? calls.filter((c) => selectedSdrIds.includes(c.user?.id || "unknown"))
        : calls;
    const filteredMeetings =
      selectedSdrIds.length > 0
        ? meetings.filter((m: any) =>
            selectedMeetingKeys.has(resolveSdrKey(m.responsable || m.sdr_nombre || "Sin SDR"))
          )
        : meetings;

    // Agrupar por país
    const countryDataMap: Record<
      string,
      {
        displayName: string;
        llamadas_realizadas: number;
        llamadas_conectadas: number;
        contactos: Set<string>;
        agendadas: number;
        realizadas: number;
        pendientes: number;
      }
    > = {};

    const getBucket = (label: string) => {
      const key = normalizeCountryKey(label);
      if (!countryDataMap[key]) {
        countryDataMap[key] = {
          displayName: label,
          llamadas_realizadas: 0,
          llamadas_conectadas: 0,
          contactos: new Set(),
          agendadas: 0,
          realizadas: 0,
          pendientes: 0,
        };
      }
      return countryDataMap[key];
    };

    for (const call of filteredCalls) {
      const label = numberCountryMap.get(call.allo_number) || "Sin país";
      const bucket = getBucket(label);
      bucket.llamadas_realizadas++;
      if (isConnected(call.duration, call.result)) bucket.llamadas_conectadas++;
      bucket.contactos.add(call.contact_number);
    }

    for (const m of filteredMeetings) {
      const label = (m.pais && String(m.pais).trim()) || "Sin país";
      const bucket = getBucket(label);
      bucket.agendadas++;
      if (m.realizado === "Si") {
        bucket.realizadas++;
      } else if (m.realizado === "Pendiente") {
        bucket.pendientes++;
      }
    }

    const paisesData: PaisMetrics[] = Object.entries(countryDataMap).map(([key, d]) => ({
      pais_key: key,
      pais_nombre: d.displayName,
      llamadas_realizadas: d.llamadas_realizadas,
      llamadas_conectadas: d.llamadas_conectadas,
      reuniones_agendadas: d.agendadas,
      reuniones_realizadas: d.realizadas,
      reuniones_pendientes: d.pendientes,
      tasa_conectadas_por_contacto: d.contactos.size > 0 ? (d.llamadas_conectadas / d.contactos.size) * 100 : 0,
      tasa_agendada_por_conectada: d.llamadas_realizadas > 0 ? (d.agendadas / d.llamadas_realizadas) * 100 : 0,
      tasa_realizacion_reuniones: d.agendadas > 0 ? (d.realizadas / d.agendadas) * 100 : 0,
    }));

    return NextResponse.json({
      paises_data: paisesData.sort((a, b) => b.llamadas_realizadas - a.llamadas_realizadas),
      all_sdrs: allSdrsRoster.sort((a, b) => a.sdr_nombre.localeCompare(b.sdr_nombre)),
    });
  } catch (err) {
    console.error("Error en /api/analisis/paises:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
