import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Endpoint TEMPORAL de diagnóstico: dump crudo de reuniones de un
// responsable específico, para comparar contra el reporte interno.
// Se borra después de usarlo — no dejar en producción.
function normalizeSdrName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function GET(req: NextRequest) {
  try {
    const sdrQuery = req.nextUrl.searchParams.get("sdr") || "Vanessa Abarzua";
    const target = normalizeSdrName(sdrQuery);

    const db = supabaseAdmin();
    // Sin filtro de fecha: created_at no sirve como proxy porque el upsert
    // (onConflict: sheet_row_key) no lo actualiza en ediciones posteriores,
    // así que una fila con fecha_agendamiento reciente puede tener
    // created_at antiguo si la fila ya existía desde antes con otro dato.
    const { data: meetings, error } = await db
      .from("meetings")
      .select("id, responsable, sdr_nombre, fecha_agendamiento, fecha_reunion, realizado, client_id, empresa, created_at")
      .order("fecha_agendamiento", { ascending: true, nullsFirst: false })
      .limit(5000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (meetings || []).filter(
      (m: any) => normalizeSdrName(m.responsable || m.sdr_nombre || "") === target
    );

    // También filas donde el nombre normalizado se PARECE pero no calza
    // exacto (para detectar variantes/typos que no estén en el alias map)
    const similar = (meetings || []).filter((m: any) => {
      const n = normalizeSdrName(m.responsable || m.sdr_nombre || "");
      return n !== target && n.length > 0 && (n.includes(target.split(" ")[0]) || target.includes(n.split(" ")[0]));
    });

    const byMonthAgendadas: Record<string, number> = {};
    const byMonthRealizadas: Record<string, number> = {};
    for (const m of rows) {
      if (m.fecha_agendamiento) {
        const key = m.fecha_agendamiento.slice(0, 7);
        byMonthAgendadas[key] = (byMonthAgendadas[key] || 0) + 1;
      }
      if (m.fecha_reunion && m.realizado === "Si") {
        const key = m.fecha_reunion.slice(0, 7);
        byMonthRealizadas[key] = (byMonthRealizadas[key] || 0) + 1;
      }
    }

    const sinFechaAgendamiento = rows.filter((m: any) => !m.fecha_agendamiento).length;

    return NextResponse.json({
      buscado: sdrQuery,
      normalizado: target,
      total_filas_matcheadas: rows.length,
      sin_fecha_agendamiento: sinFechaAgendamiento,
      resumen_agendadas_por_mes: byMonthAgendadas,
      resumen_realizadas_por_mes: byMonthRealizadas,
      nombres_similares_no_matcheados: [
        ...new Set(similar.map((m: any) => m.responsable || m.sdr_nombre)),
      ],
      // Solo filas relevantes a jun-ago 2026 (por cualquiera de las dos
      // fechas), para no devolver el historial completo
      filas_jun_a_ago_2026: rows
        .filter((m: any) => {
          const a = (m.fecha_agendamiento || "").slice(0, 7);
          const r = (m.fecha_reunion || "").slice(0, 7);
          const enRango = (k: string) => ["2026-06", "2026-07", "2026-08"].includes(k);
          return enRango(a) || enRango(r);
        })
        .map((m: any) => ({
          id: m.id,
          responsable: m.responsable,
          sdr_nombre: m.sdr_nombre,
          fecha_agendamiento: m.fecha_agendamiento,
          fecha_reunion: m.fecha_reunion,
          realizado: m.realizado,
          client_id: m.client_id,
          empresa: m.empresa,
          created_at: m.created_at,
        })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
