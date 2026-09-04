import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import { isConnected, toDateParam, callDateKey, resolveCountryLabel } from "@/lib/sdrAnalytics";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────
// "Salud Telefónica": para cada número de Allo asignado a un cliente, cuántas
// llamadas se hicieron y qué tasa de conexión tuvo en el período — comparado
// contra el período anterior — más su evolución día a día. Una tasa de
// conexión que cae fuerte y de forma sostenida suele ser la señal más clara
// (indirecta — Allo no expone un indicador propio) de que un número quedó
// marcado como spam por las operadoras.

type NumeroSalud = {
  numero: string;
  numero_nombre: string;
  cliente_id: string | null;
  cliente_nombre: string;
  pais: string;
  llamadas: number;
  llamadas_conectadas: number;
  tasa_conexion: number; // %, 0 si no hubo llamadas
  llamadas_periodo_anterior: number;
  llamadas_conectadas_periodo_anterior: number;
  tasa_conexion_anterior: number | null; // null si no hubo llamadas en el período anterior (nada con qué comparar)
  delta_puntos: number | null; // tasa_conexion - tasa_conexion_anterior, null si no hay anterior
};

type EvolucionDia = {
  fecha: string;
  porNumero: Record<string, { llamadas: number; conectadas: number }>;
};

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const clienteIdsParam = request.nextUrl.searchParams.get("cliente_ids");
    const selectedClienteIds = clienteIdsParam
      ? clienteIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const numerosParam = request.nextUrl.searchParams.get("numeros");
    const selectedNumeros = numerosParam
      ? numerosParam.split(",").map((s) => s.trim()).filter(Boolean)
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
    const prevDateFrom = toDateParam(range.previous.start);
    const prevDateTo = toDateParam(range.previous.end);

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
      return NextResponse.json({ numeros_data: [], resultados_por_dia: [], all_clientes: [], all_numeros: [] });
    }

    // Nombre/país de cada número, desde Allo
    const allNumbers = await listAlloNumbers();
    const numberMetaMap = new Map<string, { name: string; country: string }>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      numberMetaMap.set(n.number, {
        name: (n.name && n.name.trim()) || n.number,
        country: resolveCountryLabel((n.country && n.country.trim()) || "Sin país"),
      });
    }

    // Nombres de cliente (para mostrar y para el roster del filtro)
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

    const allNumerosRoster = assignedNumbers
      .map((numero) => ({
        numero,
        numero_nombre: `${numberMetaMap.get(numero)?.name || numero} (${numberMetaMap.get(numero)?.country || "?"})`,
      }))
      .sort((a, b) => a.numero_nombre.localeCompare(b.numero_nombre));

    // Números a incluir en la tabla/gráfico según los filtros de Cliente y
    // Número — el roster de arriba (para los selectores) queda sin acotar.
    const numerosEnAlcance = assignedNumbers.filter((numero) => {
      if (selectedClienteIds.length > 0 && !selectedClienteIds.includes(numberClientMap.get(numero) || "")) {
        return false;
      }
      if (selectedNumeros.length > 0 && !selectedNumeros.includes(numero)) return false;
      return true;
    });

    if (numerosEnAlcance.length === 0) {
      return NextResponse.json({
        numeros_data: [],
        resultados_por_dia: [],
        all_clientes: allClientesRoster,
        all_numeros: allNumerosRoster,
      });
    }

    // Se pide un solo rango continuo por número, desde el inicio del período
    // anterior hasta el fin del período actual, y se separa por fecha del
    // lado del cliente — evita duplicar las llamadas a Allo (una por
    // "actual" y otra por "anterior") por cada número.
    const callsByNumber = await Promise.all(
      numerosEnAlcance.map((n) =>
        searchAlloCalls({ allo_number: n, date_from: prevDateFrom, date_to: dateTo, direction: "OUTBOUND" })
      )
    );

    const seenCallIds = new Set<string>();
    const porDiaPorNumero = new Map<string, Map<string, { llamadas: number; conectadas: number }>>();
    const numeroTotales = new Map<
      string,
      { llamadas: number; conectadas: number; llamadasPrev: number; conectadasPrev: number }
    >();
    for (const numero of numerosEnAlcance) {
      numeroTotales.set(numero, { llamadas: 0, conectadas: 0, llamadasPrev: 0, conectadasPrev: 0 });
      porDiaPorNumero.set(numero, new Map());
    }

    for (let i = 0; i < numerosEnAlcance.length; i++) {
      const numero = numerosEnAlcance[i];
      const totales = numeroTotales.get(numero)!;
      const dias = porDiaPorNumero.get(numero)!;

      for (const call of callsByNumber[i]) {
        if (call.allo_number !== numero) continue; // filtro de respaldo, ver /api/analisis/sdr
        if (seenCallIds.has(call.id)) continue;
        seenCallIds.add(call.id);

        const key = callDateKey(call.date);
        const connected = isConnected(call.duration, call.result);

        if (key >= dateFrom && key <= dateTo) {
          totales.llamadas++;
          if (connected) totales.conectadas++;
          const bucket = dias.get(key) || { llamadas: 0, conectadas: 0 };
          bucket.llamadas++;
          if (connected) bucket.conectadas++;
          dias.set(key, bucket);
        } else if (key >= prevDateFrom && key <= prevDateTo) {
          totales.llamadasPrev++;
          if (connected) totales.conectadasPrev++;
        }
      }
    }

    const numerosData: NumeroSalud[] = numerosEnAlcance.map((numero) => {
      const t = numeroTotales.get(numero)!;
      const meta = numberMetaMap.get(numero);
      const clienteId = numberClientMap.get(numero) || null;
      const tasaConexion = t.llamadas > 0 ? (t.conectadas / t.llamadas) * 100 : 0;
      const tasaConexionAnterior = t.llamadasPrev > 0 ? (t.conectadasPrev / t.llamadasPrev) * 100 : null;
      return {
        numero,
        numero_nombre: meta?.name || numero,
        cliente_id: clienteId,
        cliente_nombre: clienteId ? clientMap.get(clienteId) || "Cliente desconocido" : "Sin cliente",
        pais: meta?.country || "Sin país",
        llamadas: t.llamadas,
        llamadas_conectadas: t.conectadas,
        tasa_conexion: tasaConexion,
        llamadas_periodo_anterior: t.llamadasPrev,
        llamadas_conectadas_periodo_anterior: t.conectadasPrev,
        tasa_conexion_anterior: tasaConexionAnterior,
        delta_puntos: tasaConexionAnterior === null ? null : tasaConexion - tasaConexionAnterior,
      };
    });

    // Resultados por día (solo período actual) para el gráfico de evolución.
    const resultadosPorDia: EvolucionDia[] = [];
    const currentDate = new Date(range.start);
    while (currentDate <= range.end) {
      const dateStr = toDateParam(currentDate);
      const porNumero: Record<string, { llamadas: number; conectadas: number }> = {};
      for (const numero of numerosEnAlcance) {
        const bucket = porDiaPorNumero.get(numero)!.get(dateStr);
        porNumero[numero] = bucket || { llamadas: 0, conectadas: 0 };
      }
      resultadosPorDia.push({ fecha: dateStr, porNumero });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return NextResponse.json({
      numeros_data: numerosData.sort((a, b) => b.llamadas - a.llamadas),
      resultados_por_dia: resultadosPorDia,
      all_clientes: allClientesRoster,
      all_numeros: allNumerosRoster,
    });
  } catch (err) {
    console.error("Error en /api/analisis/salud-telefonica:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
