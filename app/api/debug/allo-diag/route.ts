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
    const allNumbers = await listAlloNumbers();

    const perNumber: Record<string, { queried: number; raw: any[] }> = {};
    const allCalls: any[] = [];

    for (const n of assignedNumbers) {
      const calls = await searchAlloCalls({
        allo_number: n,
        date_from: today,
        date_to: today,
        direction: "OUTBOUND",
      });
      perNumber[n] = { queried: calls.length, raw: calls.map((c) => ({ id: c.id, allo_number: c.allo_number, date: c.date, result: c.result, duration: c.duration })) };
      for (const c of calls) allCalls.push({ ...c, __queried_number: n });
    }

    const mismatches = allCalls.filter((c) => c.allo_number !== c.__queried_number);
    const idCounts: Record<string, number> = {};
    for (const c of allCalls) idCounts[c.id] = (idCounts[c.id] || 0) + 1;
    const dupIds = Object.entries(idCounts).filter(([, count]) => count > 1);
    const uniqueIds = new Set(allCalls.map((c) => c.id));
    const outOfRange = allCalls.filter((c) => (c.date || "").slice(0, 10) !== today);

    const resultDist: Record<string, number> = {};
    allCalls.forEach((c) => {
      resultDist[c.result ?? "null"] = (resultDist[c.result ?? "null"] || 0) + 1;
    });

    return NextResponse.json({
      today,
      total_assigned_numbers: assignedNumbers.length,
      assigned_numbers: assignedNumbers,
      total_numbers_en_allo_workspace: allNumbers.length,
      total_crudo_sin_dedup: allCalls.length,
      total_unico_por_id: uniqueIds.size,
      llamadas_con_allo_number_distinto_al_consultado: mismatches.length,
      mismatches_sample: mismatches.slice(0, 15).map((c) => ({
        id: c.id,
        consultado: c.__queried_number,
        respuesta_allo_number: c.allo_number,
        date: c.date,
      })),
      ids_duplicados: dupIds.length,
      dup_ids_sample: dupIds.slice(0, 15),
      llamadas_fuera_de_rango_real: outOfRange.length,
      out_of_range_sample: outOfRange.slice(0, 15).map((c) => ({ id: c.id, allo_number: c.allo_number, date: c.date })),
      distribucion_result: resultDist,
      conteo_por_numero: Object.fromEntries(
        Object.entries(perNumber).map(([k, v]) => [k, v.queried])
      ),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
