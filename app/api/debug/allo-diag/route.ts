import { NextResponse } from "next/server";
import { listAlloNumbers, searchAlloCalls } from "@/lib/allo";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Endpoint TEMPORAL de diagnóstico: investiga por qué el conteo de llamadas
// por SDR no calza con Allo (posible mala atribución de usuario). Se borra
// después de usarlo — no dejar en producción.
export async function GET() {
  try {
    const db = supabaseAdmin();
    const { data: assigned } = await db.from("client_allo_numbers").select("allo_number, client_id");
    const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);

    const today = new Date().toISOString().slice(0, 10);
    const CHILE_UTC_OFFSET_HOURS = -4;
    const callDateKey = (isoDate: string) => {
      const shifted = new Date(new Date(isoDate).getTime() + CHILE_UTC_OFFSET_HOURS * 3600000);
      return shifted.toISOString().slice(0, 10);
    };

    const allNumbers = await listAlloNumbers();

    const rawByNumber: Record<string, any[]> = {};
    const allCalls: any[] = [];

    for (const n of assignedNumbers) {
      const calls = await searchAlloCalls({
        allo_number: n,
        date_from: today,
        date_to: today,
        direction: "OUTBOUND",
      });
      rawByNumber[n] = calls;
      for (const c of calls) allCalls.push({ ...c, __queried_number: n });
    }

    // Solo las que caen realmente hoy en hora Chile (mismo filtro que la app)
    const inRange = allCalls.filter((c) => callDateKey(c.date) === today);

    // Duplicados por id (puede haber IDs repetidos aunque estén en distintos
    // números consultados, o dentro del mismo número)
    const idCounts: Record<string, number> = {};
    for (const c of inRange) idCounts[c.id] = (idCounts[c.id] || 0) + 1;
    const dupIds = Object.entries(idCounts).filter(([, count]) => count > 1);

    // Agrupar por user.id + user.name tal cual vienen en la respuesta cruda
    const byUser: Record<string, { name: string; count: number; numbers: Set<string>; sample_ids: string[] }> = {};
    for (const c of inRange) {
      const uid = c.user?.id || "sin_user_id";
      const uname = c.user?.name || "sin_nombre";
      const key = `${uid}::${uname}`;
      if (!byUser[key]) byUser[key] = { name: uname, count: 0, numbers: new Set(), sample_ids: [] };
      byUser[key].count++;
      byUser[key].numbers.add(c.allo_number);
      if (byUser[key].sample_ids.length < 5) byUser[key].sample_ids.push(c.id);
    }

    // Usuarios registrados por número (para comparar contra lo que trae cada llamada)
    const usersByNumber: Record<string, { id: string; name: string }[]> = {};
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      usersByNumber[n.number] = n.users.map((u) => ({ id: u.id, name: u.name }));
    }

    return NextResponse.json({
      today_chile: today,
      total_en_rango_hoy: inRange.length,
      ids_duplicados: dupIds.length,
      dup_ids_sample: dupIds.slice(0, 10),
      resumen_por_usuario: Object.entries(byUser)
        .map(([key, v]) => ({
          user_id_y_nombre: key,
          cantidad: v.count,
          numeros_desde_los_que_llamo: Array.from(v.numbers),
          ejemplo_ids: v.sample_ids,
        }))
        .sort((a, b) => b.cantidad - a.cantidad),
      usuarios_registrados_por_numero: usersByNumber,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
