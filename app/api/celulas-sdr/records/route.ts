import { NextRequest, NextResponse } from "next/server";
import { loadMeetingRecords } from "@/lib/celulasSdr/server/records";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Módulo Células SDR — Registro de reuniones (espejo de solo lectura de API
// Reuniones). ?from=YYYY-MM-DD&to=YYYY-MM-DD&field=md|sd. Requiere sesión.
// Lógica en lib/celulasSdr/server/records.ts.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await loadMeetingRecords(request.nextUrl.searchParams));
  } catch (err) {
    console.error("Error en /api/celulas-sdr/records:", err);
    const msg = (err as Error).message || "Error interno";
    return NextResponse.json({ error: msg }, { status: /posterior/.test(msg) ? 400 : 500 });
  }
}
