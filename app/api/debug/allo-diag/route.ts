import { NextResponse } from "next/server";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Endpoint TEMPORAL de diagnóstico para comparar el conteo de llamadas de
// hoy que trae nuestra API vs lo que reporta el dashboard de Allo. Se borra
// después de usarlo — no dejar en producción.
export async function GET() {
  try {
    const db = supabaseAdmin();
    const { data: assigned } = await db.from("client_allo_numbers").select("allo_number, client_id");
    const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const perNumberRaw: Record<string, any[]> = {};
    const allCalls: any[] = [];

    for (const n of assignedNumbers) {
      const calls = await searchAlloCalls({
        allo_number: n,
        date_from: today,
        date_to: today,
        direction: "OUTBOUND",
      });
      perNumberRaw[n] = calls;
      for (const c of calls) allCalls.push({ ...c, __queried_number: n });
    }

    const uniqueIds = new Set(allCalls.map((c) => c.id));
    const inRange = allCalls.filter((c) => (c.date || "").slice(0, 10) === today);
    const inRangeUniqueIds = new Set(inRange.map((c) => c.id));
    const outOfRange = allCalls.filter((c) => (c.date || "").slice(0, 10) !== today);

    const resultDistInRange: Record<string, number> = {};
    inRange.forEach((c) => {
      resultDistInRange[c.result ?? "null"] = (resultDistInRange[c.result ?? "null"] || 0) + 1;
    });

    const conteoPorNumeroEnRango: Record<string, number> = {};
    for (const n of assignedNumbers) {
      conteoPorNumeroEnRango[n] = inRange.filter((c) => c.allo_number === n).length;
    }

    return NextResponse.json({
      consultado_a_las: nowIso,
      today,
      total_crudo_sin_dedup: allCalls.length,
      total_unico_por_id: uniqueIds.size,
      total_en_rango_hoy: inRangeUniqueIds.size,
      total_fuera_de_rango: outOfRange.length,
      distribucion_result_en_rango: resultDistInRange,
      conteo_por_numero_en_rango: conteoPorNumeroEnRango,
      // Horas (UTC) de las llamadas de hoy, para ver si hay algo raro en los bordes del día
      horas_utc_en_rango: inRange.map((c) => c.date).sort(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
