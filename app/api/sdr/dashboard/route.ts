import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dashboard SDR: GET ?sdr=<clave>&fresh=1. Sin ?sdr= muestra al SDR de la
// sesión (por su correo en la Maestra). Lógica en lib/dashboardSdr/server.ts.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const email = await currentUserEmail();
    const data = await loadSdrDashboard({ sdr: p.get("sdr"), email, fresh: p.get("fresh") === "1" });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Error en /api/sdr/dashboard:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
