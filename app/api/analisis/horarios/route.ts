import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import { isConnected, toDateParam, callDateKey, resolveCountryLabel, normalizeCountryKey } from "@/lib/sdrAnalytics";
import { toChileParts } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Mejores horarios para conectar": mapa de calor Día de semana × Hora (de
// Chile) con la tasa de conexión (misma definición que el resto de la app:
// contestada o transferida, 60 segundos o más — excluye buzón de voz) de
// las llamadas hechas en ese día/hora, en el período y alcance elegidos.

type CeldaHeatmap = {
  dia: number; // 0=Lunes ... 6=Domingo
  hora: number; // 0-23, hora de Chile
  llamadas: number;
  conectadas: number;
  tasa: number; // %, 0 si no hubo llamadas
};

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const clienteIdsParam = request.nextUrl.searchParams.get("cliente_ids");
    const selectedClienteIds = clienteIdsParam
      ? clienteIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const paisesParam = request.nextUrl.searchParams.get("paises");
    const selectedPaisKeys = paisesParam ? paisesParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
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

    // Números de Allo asignados (con su client_id)
    let assignedQuery = db.from("client_allo_numbers").select("allo_number, client_id");
    if (!isAllClients) {
      assignedQuery = assignedQuery.eq("client_id", clientId);
    }
    const { data: assigned, error: assignedErr } = await assignedQuery;

    if (assignedErr) {
      return NextResponse.json({ error: assignedErr.message }, { status: 500 });
    }

    const numberClientMap = new Map<string, string>();
    for (const r of assigned ?? []) {
      numberClientMap.set(r.allo_number, r.client_id);
    }
    const assignedNumbers = [...numberClientMap.keys()];

    if (assignedNumbers.length === 0) {
      return NextResponse.json({ heatmap: [], total_llamadas: 0, all_clientes: [], all_paises: [] });
    }

    // País y nombre de cada número, desde Allo (mismo criterio que
    // /api/analisis/paises: el campo "country" de la propia API de Allo).
    const allNumbers = await listAlloNumbers();
    const numberCountryMap = new Map<string, string>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      const label = (n.country && n.country.trim()) || (n.name && n.name.trim()) || "Sin país";
      numberCountryMap.set(n.number, resolveCountryLabel(label));
    }

    // Nombres de cliente (para el roster del filtro)
    const allClientIdsSeen = new Set(numberClientMap.values());
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
    const allClientesRoster = [...allClientIdsSeen]
      .map((id) => ({ cliente_id: id, cliente_nombre: clientMap.get(id) || "Cliente desconocido" }))
      .sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre));

    const allPaisesRosterMap = new Map<string, string>(); // pais_key -> nombre
    for (const label of numberCountryMap.values()) {
      allPaisesRosterMap.set(normalizeCountryKey(label), label);
    }
    const allPaisesRoster = [...allPaisesRosterMap.entries()]
      .map(([pais_key, pais_nombre]) => ({ pais_key, pais_nombre }))
      .sort((a, b) => a.pais_nombre.localeCompare(b.pais_nombre));

    // Números en alcance según Cliente/País seleccionados.
    const numerosEnAlcance = assignedNumbers.filter((numero) => {
      if (selectedClienteIds.length > 0 && !selectedClienteIds.includes(numberClientMap.get(numero) || "")) {
        return false;
      }
      if (selectedPaisKeys.length > 0) {
        const key = normalizeCountryKey(numberCountryMap.get(numero) || "Sin país");
        if (!selectedPaisKeys.includes(key)) return false;
      }
      return true;
    });

    if (numerosEnAlcance.length === 0) {
      return NextResponse.json({
        heatmap: [],
        total_llamadas: 0,
        all_clientes: allClientesRoster,
        all_paises: allPaisesRoster,
      });
    }

    const callsByNumber = await Promise.all(
      numerosEnAlcance.map((n) => searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" }))
    );

    // Grilla Día (0=Lunes...6=Domingo) × Hora (0-23, hora de Chile).
    const grid: { llamadas: number; conectadas: number }[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ llamadas: 0, conectadas: 0 }))
    );

    const seenCallIds = new Set<string>();
    let totalLlamadas = 0;
    for (const calls of callsByNumber) {
      for (const call of calls) {
        if (!numerosEnAlcance.includes(call.allo_number)) continue; // filtro de respaldo, ver /api/analisis/sdr
        const key = callDateKey(call.date);
        if (key < dateFrom || key > dateTo) continue;
        if (seenCallIds.has(call.id)) continue;
        seenCallIds.add(call.id);

        const chile = toChileParts(new Date(call.date));
        // getUTCDay(): 0=domingo...6=sábado → se convierte a 0=lunes...6=domingo
        const dow = chile.getUTCDay();
        const dia = dow === 0 ? 6 : dow - 1;
        const hora = chile.getUTCHours();

        grid[dia][hora].llamadas++;
        totalLlamadas++;
        if (isConnected(call.duration, call.result)) {
          grid[dia][hora].conectadas++;
        }
      }
    }

    const heatmap: CeldaHeatmap[] = [];
    for (let dia = 0; dia < 7; dia++) {
      for (let hora = 0; hora < 24; hora++) {
        const { llamadas, conectadas } = grid[dia][hora];
        heatmap.push({
          dia,
          hora,
          llamadas,
          conectadas,
          tasa: llamadas > 0 ? (conectadas / llamadas) * 100 : 0,
        });
      }
    }

    return NextResponse.json({
      heatmap,
      total_llamadas: totalLlamadas,
      all_clientes: allClientesRoster,
      all_paises: allPaisesRoster,
    });
  } catch (err) {
    console.error("Error en /api/analisis/horarios:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
