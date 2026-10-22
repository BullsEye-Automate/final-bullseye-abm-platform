import { NextRequest, NextResponse } from "next/server";
import { loadAlloMonth } from "@/lib/celulasSdr/server/allo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Módulo Células SDR — llamadas, contactados y score de Allo de un mes. Lógica en lib/celulasSdr/server/allo.ts (la reutiliza el
// envío diario de alertas por correo a las líderes de célula).
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    return NextResponse.json(await loadAlloMonth(sp.get("month") ?? "", sp.get("refresh") === "1"));
  } catch (err) {
    console.error("Error en /api/celulas-sdr/allo:", err);
    const msg = (err as Error).message || "Error interno";
    return NextResponse.json({ error: msg }, { status: /requerido/.test(msg) ? 400 : 500 });
  }
}
