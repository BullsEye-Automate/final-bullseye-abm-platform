import { NextRequest, NextResponse } from "next/server";
import { sendHolidayAlert, markAlertSent, wasAlertSent } from "@/lib/feriados/mail";
import { chileDay, weekday } from "@/lib/feriados/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: Alerta de feriados diaria a las 8:30 de Chile, lunes a
// viernes (también en feriados de Chile: los otros países siguen llamando).
// Avisa los feriados del día hábil siguiente (el viernes, los del lunes).
// Vercel agenda en UTC y Chile cambia de horario, así que vercel.json dispara
// a las 11:30, 12:30 y 13:30 UTC y acá se envía solo cuando en Chile son las
// 8:xx; a las 9:xx se reintenta si el envío de las 8:30 no quedó registrado.
// ?force=1 (con CRON_SECRET) se salta el chequeo de hora y día.
function chileHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(now)
  );
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
  const day = chileDay();
  const hour = chileHour();
  const SEND_HOUR = 8;
  const isRetry = hour === SEND_HOUR + 1;

  if (!force) {
    const w = weekday(day);
    if (w === 0 || w === 6) return NextResponse.json({ skipped: `Fin de semana (${day})` });
    if (hour !== SEND_HOUR && !isRetry) return NextResponse.json({ skipped: `Hora de Chile ${hour}:xx no corresponde a las 8:30 ni a su reintento` });
    if (await wasAlertSent(day)) return NextResponse.json({ skipped: `La alerta de hoy ya se envió` });
  }

  try {
    const sent = await sendHolidayAlert();
    await markAlertSent(day);
    return NextResponse.json({ sent, retry: isRetry });
  } catch (err) {
    console.error(`Error en /api/cron/alerta-feriados${isRetry ? " (reintento)" : ""}:`, err);
    return NextResponse.json({ error: (err as Error).message || "Error interno", retry: isRetry }, { status: 500 });
  }
}
