import { NextRequest, NextResponse } from "next/server";
import { loadReturns } from "@/lib/celulasSdr/server/returns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Módulo Células SDR — Devoluciones (?fresh=1 recalcula; si no, caché del
// día de 6 h). Lógica en lib/celulasSdr/server/returns.ts.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await loadReturns(request.nextUrl.searchParams.get("fresh") === "1"));
  } catch (err) {
    console.error("Error en /api/celulas-sdr/devoluciones:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
