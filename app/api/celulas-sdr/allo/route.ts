import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { listAlloNumbers, searchAlloCalls, fetchAlloConnectedCallIds, resolveConnected } from "@/lib/allo";
import { callDateKey, resolveSdrKey } from "@/lib/sdrAnalytics";
import { parseCallScoreCard } from "@/lib/callScoreCard";
import { countryFromPhone } from "@/lib/celulasSdr/country";
import { chileToday, monthEnd, monthStart } from "@/lib/celulasSdr/calendar";
import { monthCacheTtlMs, readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import type { AlloMonthResponse, CallDay, CallEval } from "@/lib/celulasSdr/types";

export const dynamic = "force-dynamic";
// Un mes completo de llamadas salientes de todos los números de Allo (con
// el límite de 5 req/s de Allo) puede tardar bastante la primera vez; luego
// queda en caché (lib/celulasSdr/cache.ts).
export const maxDuration = 300;

// Módulo Células SDR — actividad telefónica de un mes desde Allo:
// - llamadas salientes y contactados (etapa "Conversación" del embudo de
//   Allo, la misma definición que usa Análisis SDR) por día × SDR × cliente
//   × país (país = código telefónico del número de Allo);
// - llamadas con "Score de Desempeño SDR" generado por la IA de Allo en el
//   summary (lib/callScoreCard.ts), solo entre las conectadas — mismo
//   criterio que el reporte "Score de Llamadas IA".
// No se devuelve ningún dato del prospecto (número, nombre, empresa).

const CACHE_VERSION = "v1";

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month (YYYY-MM) es requerido" }, { status: 400 });
    }
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const today = chileToday();
    const cacheKey = `celulas-sdr:allo:${CACHE_VERSION}:${month}`;
    if (!refresh) {
      const cached = await readMonthCache<AlloMonthResponse>(cacheKey);
      if (cached) return NextResponse.json(cached);
    }

    const dateFrom = monthStart(month);
    const end = monthEnd(month);
    const dateTo = end > today ? today : end;
    const empty: AlloMonthResponse = { month, calls: [], evals: [], sdrNames: {}, connectedSource: "allo", cachedAt: new Date().toISOString(), warnings: [] };
    if (dateFrom > today) return NextResponse.json(empty);

    const db = supabaseAdmin();
    const { data: assigned, error } = await db.from("client_allo_numbers").select("allo_number, client_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const numbers = (assigned ?? []).map((r) => r.allo_number as string);
    const clientOf = new Map((assigned ?? []).map((r) => [r.allo_number as string, r.client_id as string]));
    if (numbers.length === 0) {
      empty.warnings.push({ source: "Allo", message: "No hay números de Allo asignados a clientes (Configuración → Cliente → Allo)." });
      return NextResponse.json(empty);
    }

    const [callsByNumber, allNumbers, connectedIds] = await Promise.all([
      Promise.all(numbers.map((n) => searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND", maxItems: 20000 }))),
      listAlloNumbers(),
      fetchAlloConnectedCallIds({ allo_numbers: numbers, date_from: dateFrom, date_to: dateTo }),
    ]);
    const countryLabelOf = new Map(allNumbers.map((n) => [n.number, n.country]));

    const agg = new Map<string, CallDay>();
    const evals: CallEval[] = [];
    const sdrNames: Record<string, string> = {};
    const seen = new Set<string>();
    const assignedSet = new Set(numbers);

    for (const c of callsByNumber.flat()) {
      // Mismos filtros de respaldo que el resto de Análisis SDR (ver
      // /api/analisis/sdr): número asignado, fecha dentro del rango, sin duplicados.
      if (!assignedSet.has(c.allo_number)) continue;
      const d = callDateKey(c.date);
      if (d < dateFrom || d > dateTo) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);

      const userName = c.user?.name?.trim() || "Sin usuario";
      const s = resolveSdrKey(userName);
      sdrNames[s] = sdrNames[s] ?? userName;
      const client = clientOf.get(c.allo_number) ?? null;
      const k = countryFromPhone(c.allo_number, countryLabelOf.get(c.allo_number));
      const connected = resolveConnected(c, connectedIds);

      const key = `${d}|${s}|${client}|${k}`;
      const row = agg.get(key) ?? { d, s, c: client, k, calls: 0, contacted: 0 };
      row.calls++;
      if (connected) row.contacted++;
      agg.set(key, row);

      if (connected) {
        const card = parseCallScoreCard(c.summary);
        if (card) {
          evals.push({
            id: c.id,
            d,
            s,
            c: client,
            k,
            dur: c.duration,
            score: card.puntajeTotal,
            crit: card.desglose.map((x) => (x.score == null ? null : Math.round(x.score * 10) / 10)),
            nivel: card.nivel,
            strength: card.fortalezaPrincipal ? card.fortalezaPrincipal.slice(0, 400) : null,
            improve: card.oportunidadMejora ? card.oportunidadMejora.slice(0, 400) : null,
          });
        }
      }
    }

    const body: AlloMonthResponse = {
      month,
      calls: [...agg.values()],
      evals,
      sdrNames,
      connectedSource: connectedIds ? "allo" : "fallback",
      cachedAt: new Date().toISOString(),
      warnings: connectedIds
        ? []
        : [{ source: "Allo", message: "No se pudo leer el embudo de Allo; los contactados se estimaron como llamadas contestadas de 60 s o más." }],
    };
    await writeMonthCache(cacheKey, body, monthCacheTtlMs(month, today.slice(0, 7)));
    return NextResponse.json(body);
  } catch (err) {
    console.error("Error en /api/celulas-sdr/allo:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
