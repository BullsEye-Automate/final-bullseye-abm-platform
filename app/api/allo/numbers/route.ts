import { NextResponse } from "next/server";
import { listAlloNumbers } from "@/lib/allo";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Lista en vivo los números de Allo del workspace, para el desplegable de
// "config cliente". No se cachea: son pocos números y deben reflejar
// siempre lo que existe en Allo. Se enriquece con qué cliente (si alguno)
// ya tiene asignado cada número, para poder deshabilitarlo en la UI en vez
// de esperar el error de conflicto al asignarlo.
export async function GET() {
  try {
    const numbers = await listAlloNumbers();

    const assignedByNumber = new Map<string, { client_id: string; client_name: string | null }>();
    try {
      const db = supabaseAdmin();
      const { data } = await db
        .from("client_allo_numbers")
        .select("allo_number, client_id, clients(name)");
      for (const row of data ?? []) {
        assignedByNumber.set(row.allo_number, {
          client_id: row.client_id,
          client_name: (row as any).clients?.name ?? null,
        });
      }
    } catch {
      // Si falla la consulta de asignaciones, mostramos igual el catálogo de Allo sin esa info.
    }

    const enriched = numbers.map((n) => {
      const a = assignedByNumber.get(n.number);
      return {
        ...n,
        assigned_client_id: a?.client_id ?? null,
        assigned_client_name: a?.client_name ?? null,
      };
    });

    return NextResponse.json({ numbers: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Allo" }, { status: 500 });
  }
}
