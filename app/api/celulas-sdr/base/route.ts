import { NextRequest, NextResponse } from "next/server";
import { loadBase } from "@/lib/celulasSdr/server/base";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Módulo Células SDR — metas, células, SDR, clientes y reuniones. Lógica en lib/celulasSdr/server/base.ts (la reutiliza el
// envío diario de alertas por correo a las líderes de célula).
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    return NextResponse.json(await loadBase(sp.get("month")));
  } catch (err) {
    console.error("Error en /api/celulas-sdr/base:", err);
    const msg = (err as Error).message || "Error interno";
    return NextResponse.json({ error: msg }, { status: /requerido/.test(msg) ? 400 : 500 });
  }
}
