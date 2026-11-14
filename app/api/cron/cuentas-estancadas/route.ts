import { NextRequest, NextResponse } from "next/server";
import { runStaleAlerts } from "@/lib/dashboardSdr/staleAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Alerta semanal de cuentas estancadas (lib/dashboardSdr/staleAlerts.ts).
// Vercel Cron lunes y martes a las 12 y 13 UTC: envía una vez por semana, el
// primer día hábil, cuando en Chile son las 9:xx o 10:xx.
// ?force=1 (con CRON_SECRET) se salta el chequeo de día, hora y "ya enviado".
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runStaleAlerts({ force: req.nextUrl.searchParams.get("force") === "1" }));
  } catch (err) {
    console.error("Error en /api/cron/cuentas-estancadas:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
