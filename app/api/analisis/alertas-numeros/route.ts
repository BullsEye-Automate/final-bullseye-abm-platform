import { NextRequest, NextResponse } from "next/server";
import { buildPhoneHealthReport } from "@/lib/phoneHealth/server";
import { readAlertState, runPhoneAlerts, alertRecipients } from "@/lib/phoneHealth/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Alertas de Números (Análisis SDR). Requiere sesión (middleware).
// GET  → semáforo por número (últimos 7 días vs su promedio de 4 semanas) +
//        desde cuándo está en alerta cada uno.
// POST → envía el correo en el momento a los destinatarios configurados
//        (no modifica el estado de las alertas).
export async function GET() {
  try {
    const [report, state] = await Promise.all([buildPhoneHealthReport(), readAlertState().catch(() => new Map())]);
    const since: Record<string, string> = {};
    for (const [num, row] of state) since[num] = (row as any).since;
    return NextResponse.json({ ...report, since, recipients: alertRecipients() });
  } catch (err) {
    console.error("Error en /api/analisis/alertas-numeros:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(_req: NextRequest) {
  try {
    return NextResponse.json(await runPhoneAlerts({ cron: false }));
  } catch (err) {
    console.error("Error en POST /api/analisis/alertas-numeros:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
