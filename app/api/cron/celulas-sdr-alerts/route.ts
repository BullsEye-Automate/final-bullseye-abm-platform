import { NextRequest, NextResponse } from "next/server";
import { sendCellAlerts } from "@/lib/celulasSdr/server/alertsMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (días hábiles, ver vercel.json): correo diario de alertas a las
// líderes de célula. Se valida CRON_SECRET igual que el resto de /api/cron.
// Mientras CELULAS_ALERTS_MODE no sea "live", los correos van solo a la
// casilla de prueba (ver lib/celulasSdr/server/alertsMail.ts).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    return NextResponse.json(await sendCellAlerts());
  } catch (err) {
    console.error("Error en /api/cron/celulas-sdr-alerts:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
