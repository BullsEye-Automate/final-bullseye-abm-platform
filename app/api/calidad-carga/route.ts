import { NextRequest, NextResponse } from "next/server";
import { getCargaReport } from "@/lib/calidadCarga/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Calidad de carga (requiere sesión, ver middleware.ts):
// ?client_id= (obligatorio), ?days= (7–90, por defecto 30), ?fresh=1 recalcula.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("client_id");
  if (!clientId || clientId === "__all__") return NextResponse.json({ error: "Elige un cliente" }, { status: 400 });
  const days = Math.min(90, Math.max(7, Number(sp.get("days")) || 30));
  try {
    return NextResponse.json(await getCargaReport(clientId, days, sp.get("fresh") === "1"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
