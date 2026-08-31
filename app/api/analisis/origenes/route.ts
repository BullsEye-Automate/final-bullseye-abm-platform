import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { resolveSdrKey, toDateParam } from "@/lib/sdrAnalytics";

export const dynamic = "force-dynamic";

// Reporte "Origen de Reuniones": a diferencia del Ranking SDR (que separa
// Agendadas por fecha_agendamiento y Realizadas por fecha_reunion), este
// reporte muestra el total de reuniones del período sin importar su estado
// (Sí/No/Pendiente/Reagendar), filtrando por fecha_reunion — la misma fecha
// que usa /api/meetings (el módulo de Reuniones).

type MeetingDetail = {
  id: string;
  sdr_nombre: string;
  client_name: string;
  prospecto_nombre?: string;
  empresa?: string;
  fecha_agendamiento?: string;
  fecha_reunion: string;
  origen: string;
};

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const sdrIdsParam = request.nextUrl.searchParams.get("sdr_ids");
    const selectedSdrKeys = sdrIdsParam ? sdrIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
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

    // Igual que /api/analisis/sdr: PostgREST limita a 1000 filas por
    // respuesta, así que se pagina con .range() hasta traer todas.
    const MEETINGS_PAGE_SIZE = 1000;
    const meetings: any[] = [];
    let meetingsError: { message: string } | null = null;
    for (let offset = 0; ; offset += MEETINGS_PAGE_SIZE) {
      let meetingsQuery = db
        .from("meetings")
        .select("id, sdr_nombre, responsable, fecha_reunion, fecha_agendamiento, realizado, contacto_nombre, empresa, client_id, origen")
        .gte("fecha_reunion", dateFrom)
        .lte("fecha_reunion", dateTo)
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

    const clientIds = [...new Set(meetings.map((m: any) => m.client_id).filter(Boolean))];
    let clientsData: any[] = [];
    if (clientIds.length > 0) {
      const { data: clients, error: clientsError } = await db.from("clients").select("id, name").in("id", clientIds);
      if (clientsError) {
        console.error("Error obteniendo clientes:", clientsError);
      }
      clientsData = clients || [];
    }
    const clientMap = new Map(clientsData.map((c: any) => [c.id, c.name]));

    // Rosters para los filtros (calculados sobre todas las reuniones del
    // período/cliente, antes de aplicar el filtro de SDR/Cliente, para que
    // el selector no se achique una vez que ya hay algo seleccionado).
    const allSdrsRosterMap = new Map<string, string>(); // sdr_key -> nombre a mostrar
    for (const m of meetings) {
      const rawName = m.responsable || m.sdr_nombre || "Sin SDR";
      allSdrsRosterMap.set(resolveSdrKey(rawName), rawName);
    }
    const allSdrsRoster = [...allSdrsRosterMap.entries()]
      .map(([sdr_id, sdr_nombre]) => ({ sdr_id, sdr_nombre }))
      .sort((a, b) => a.sdr_nombre.localeCompare(b.sdr_nombre));

    const allClientesRoster = clientIds
      .map((id) => ({ cliente_id: id, cliente_nombre: clientMap.get(id) || "Sin cliente" }))
      .sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre));

    const filteredMeetings = meetings.filter((m: any) => {
      if (selectedSdrKeys.length > 0) {
        const key = resolveSdrKey(m.responsable || m.sdr_nombre || "Sin SDR");
        if (!selectedSdrKeys.includes(key)) return false;
      }
      if (selectedClienteIds.length > 0 && !selectedClienteIds.includes(m.client_id)) return false;
      return true;
    });

    const reuniones: MeetingDetail[] = filteredMeetings.map((m: any) => ({
      id: m.id,
      sdr_nombre: m.responsable || m.sdr_nombre || "Sin SDR",
      client_name: clientMap.get(m.client_id) || "Sin cliente",
      prospecto_nombre: m.contacto_nombre,
      empresa: m.empresa,
      fecha_agendamiento: m.fecha_agendamiento,
      fecha_reunion: m.fecha_reunion,
      origen: (m.origen && String(m.origen).trim()) || "Sin origen",
    }));

    return NextResponse.json({
      reuniones,
      all_sdrs: allSdrsRoster,
      all_clientes: allClientesRoster,
    });
  } catch (err) {
    console.error("Error en /api/analisis/origenes:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
