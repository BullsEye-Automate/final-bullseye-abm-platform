import { NextRequest, NextResponse } from "next/server";
import { runPhoneAlerts } from "@/lib/phoneHealth/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: Alertas de Números, días hábiles a las 8:00 de Chile.
// Vercel agenda en UTC y Chile cambia de horario, así que vercel.json lo
// dispara a las 11 y 12 UTC y acá se ejecuta solo el que coincide con las
// 8:00 de America/Santiago (igual que /api/cron/reporte-sdr).
// ?force=1 (con CRON_SECRET) se salta el chequeo de hora.
function chileHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const hour = chileHour();
  if (!force && hour !== 8) {
    return NextResponse.json({ skipped: `Hora de Chile ${hour}:xx ≠ 8:00 (la otra ejecución UTC es la que corre)` });
  }
  try {
    return NextResponse.json(await runPhoneAlerts({ cron: true }));
  } catch (err) {
    console.error("Error en /api/cron/alertas-numeros:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
