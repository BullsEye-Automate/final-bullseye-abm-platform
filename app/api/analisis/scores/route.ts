import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import { toDateParam, callDateKey } from "@/lib/sdrAnalytics";
import { parseCallScoreCard, SCORE_CARD_CATEGORIES } from "@/lib/callScoreCard";

export const dynamic = "force-dynamic";

// ─── Tipos ──────────────────────────────────────────────────────────────────
// Resumen de los análisis de llamadas con IA que genera Allo (ver
// lib/callScoreCard.ts) — no todas las llamadas tienen este análisis
// (solo ~5-6% en una muestra reciente), así que este reporte agrupa
// únicamente las que sí lo tienen.

type ScoreCallSummary = {
  id: string;
  date: string;
  contact_number: string;
  contact_name: string | null;
  cliente_nombre: string;
  puntaje_total: number;
  nivel: string | null;
  desglose: Record<string, number | null>;
  has_recording: boolean;
  summary: string; // texto completo (Markdown) generado por Allo, para el detalle
};

type SdrScoreMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_analizadas: number;
  puntaje_total: number; // promedio
  desglose: Record<string, number | null>; // promedio por categoría (null si ninguna llamada tuvo ese ítem)
  calls: ScoreCallSummary[];
};

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const sdrIdsParam = request.nextUrl.searchParams.get("sdr_ids") || request.nextUrl.searchParams.get("sdr_id");
    const selectedSdrIds = sdrIdsParam ? sdrIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
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

    // Números de Allo asignados (con su client_id)
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
      return NextResponse.json({ sdr_scores: [], all_sdrs: [], all_clientes: [] });
    }

    const [callsByNumber, allNumbers] = await Promise.all([
      Promise.all(
        assignedNumbers.map((n) =>
          searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
        )
      ),
      listAlloNumbers(),
    ]);

    const userMap = new Map<string, string>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      for (const u of n.users) userMap.set(u.id, u.name);
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

    // Mismos filtros de respaldo que el resto de rutas de Análisis (ver
    // /api/analisis/sdr/route.ts para el detalle de cada uno): fecha, número
    // asignado, duplicados — más el filtro de cliente/SDR de este reporte.
    const seenCallIds = new Set<string>();
    const calls = callsByNumber.flat().filter((c) => {
      if (!assignedNumbers.includes(c.allo_number)) return false;
      const key = callDateKey(c.date);
      if (key < dateFrom || key > dateTo) return false;
      if (seenCallIds.has(c.id)) return false;
      seenCallIds.add(c.id);
      if (selectedSdrIds.length > 0 && !selectedSdrIds.includes(c.user?.id || "unknown")) return false;
      if (selectedClienteIds.length > 0 && !selectedClienteIds.includes(numberClientMap.get(c.allo_number) || "")) {
        return false;
      }
      return true;
    });

    // Roster completo de SDRs disponibles para el filtro (todos los
    // asignados a los números del alcance, tengan o no llamadas analizadas)
    const allSdrsRoster = [...userMap.entries()]
      .map(([sdr_id, sdr_nombre]) => ({ sdr_id, sdr_nombre }))
      .sort((a, b) => a.sdr_nombre.localeCompare(b.sdr_nombre));

    // Agrupar por SDR solo las llamadas que sí tienen análisis de IA con
    // score (parseCallScoreCard devuelve null si Allo no generó ese
    // análisis para la llamada — la mayoría de las llamadas caen acá).
    const bySdr: Record<
      string,
      { sdr_nombre: string; calls: ScoreCallSummary[]; sums: Record<string, number>; counts: Record<string, number> }
    > = {};

    for (const call of calls) {
      const card = parseCallScoreCard(call.summary);
      if (!card) continue;

      const sdrId = call.user?.id || "unknown";
      const sdrNombre = userMap.get(sdrId) || call.user?.name || sdrId;
      if (!bySdr[sdrId]) {
        bySdr[sdrId] = { sdr_nombre: sdrNombre, calls: [], sums: { total: 0 }, counts: { total: 0 } };
        for (const { label } of SCORE_CARD_CATEGORIES) {
          bySdr[sdrId].sums[label] = 0;
          bySdr[sdrId].counts[label] = 0;
        }
      }
      const bucket = bySdr[sdrId];

      const desglose: Record<string, number | null> = {};
      for (const { label } of SCORE_CARD_CATEGORIES) {
        const item = card.desglose.find((d) => d.label === label);
        desglose[label] = item?.score ?? null;
        if (item?.score != null) {
          bucket.sums[label] += item.score;
          bucket.counts[label] += 1;
        }
      }

      bucket.sums.total += card.puntajeTotal;
      bucket.counts.total += 1;

      bucket.calls.push({
        id: call.id,
        date: call.date,
        contact_number: call.contact_number,
        contact_name: call.extracted_contact.name,
        cliente_nombre: clientMap.get(numberClientMap.get(call.allo_number) || "") || "Sin cliente",
        puntaje_total: card.puntajeTotal,
        nivel: card.nivel,
        desglose,
        has_recording: !!call.recording_url,
        summary: call.summary || "",
      });
    }

    const sdrScores: SdrScoreMetrics[] = Object.entries(bySdr).map(([sdrId, b]) => {
      const desglose: Record<string, number | null> = {};
      for (const { label } of SCORE_CARD_CATEGORIES) {
        desglose[label] = b.counts[label] > 0 ? b.sums[label] / b.counts[label] : null;
      }
      return {
        sdr_id: sdrId,
        sdr_nombre: b.sdr_nombre,
        llamadas_analizadas: b.counts.total,
        puntaje_total: b.counts.total > 0 ? b.sums.total / b.counts.total : 0,
        desglose,
        calls: b.calls.sort((a, c) => (a.date < c.date ? 1 : -1)),
      };
    });

    return NextResponse.json({
      sdr_scores: sdrScores.sort((a, b) => b.puntaje_total - a.puntaje_total),
      all_sdrs: allSdrsRoster,
      all_clientes: allClientesRoster,
    });
  } catch (err) {
    console.error("Error en /api/analisis/scores:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
