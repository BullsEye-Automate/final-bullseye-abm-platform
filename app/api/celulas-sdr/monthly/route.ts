import { NextRequest, NextResponse } from "next/server";
import { loadMonthlyMeetings } from "@/lib/celulasSdr/server/monthly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Módulo Células SDR — evolutivo mensual de reuniones (?year=YYYY, por
// defecto el año en curso). Lógica en lib/celulasSdr/server/monthly.ts.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await loadMonthlyMeetings(request.nextUrl.searchParams.get("year")));
  } catch (err) {
    console.error("Error en /api/celulas-sdr/monthly:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
