import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";
import { liveCompanies } from "@/lib/dashboardSdr/live";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dashboard SDR → «Mis listas»: empresas del SDR leídas en vivo de HubSpot
// (lib/dashboardSdr/live.ts). GET ?sdr=<clave>. Con sesión; todos ven todo.
export async function GET(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const sdr = req.nextUrl.searchParams.get("sdr");
    if (!sdr) return NextResponse.json({ error: "Falta sdr" }, { status: 400 });
    const slice = (await loadSdrDashboard({ sdr, email })).sdr;
    if (!slice) return NextResponse.json({ error: "SDR sin cartera" }, { status: 404 });
    return NextResponse.json(await liveCompanies(slice.key, slice.accts ?? {}));
  } catch (err) {
    console.error("Error en /api/sdr/dashboard/vivo:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
