import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadCoverage } from "@/lib/academiaSdr/server/source";

export const dynamic = "force-dynamic";

// Clientes activos con y sin Entrenamiento cliente (alerta de los que faltan).
export async function GET() {
  try {
    return NextResponse.json({ clients: await loadCoverage(supabaseAdmin()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
