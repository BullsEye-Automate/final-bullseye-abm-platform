import { NextRequest, NextResponse } from "next/server";
import { sendDailySdrReport, markReportSent, wasReportSent, sendReportFailureNotice, markReportFailure, lastReportFailure, failureCause, delayNotice } from "@/lib/reporteSdr/send";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: Reporte SDR diario por correo (PNG adjunto) a las 13:00 y
// 18:30 de Chile, lunes a viernes hábiles. Parámetros: ?slot=13 | ?slot=18.
// ?force=1 (con CRON_SECRET) se salta el chequeo de hora / día hábil / ya
// enviado.
//
// Reintentos cada 15 minutos (confirmado con BullsEye, nov-2026, tras la
// caída de Allo del 5-nov): vercel.json dispara cada 15 min en las horas UTC
// que cubren el corte en verano (UTC-3) e invierno (UTC-4). Cada disparo
// mira la hora real de Chile: entre el corte y 2 horas después
// (WINDOW_MIN), si el corte de hoy aún no quedó registrado como enviado, lo
// intenta. Si un intento falla se guarda el motivo; el envío posterior que
// sí resulte lleva el aviso "Enviado a las HH:MM por una falla en … en el
// horario habitual". Si el último intento de la ventana también falla, se
// avisa por correo a los destinatarios (una vez).
const SLOTS: Record<string, { min: number; label: string }> = {
  "13": { min: 13 * 60, label: "13:00" },
  "18": { min: 18 * 60 + 30, label: "18:30" },
};
const WINDOW_MIN = 120;      // se reintenta hasta 2 h después del corte
const STEP_MIN = 15;         // cada 15 minutos
const ON_TIME_MIN = 10;      // un envío dentro de 10 min del corte no lleva aviso

function chileNow(now = new Date()): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const slotKey = req.nextUrl.searchParams.get("slot") ?? "";
  const slot = SLOTS[slotKey];
  if (!slot) return NextResponse.json({ error: "slot inválido (13 o 18)" }, { status: 400 });

  const force = req.nextUrl.searchParams.get("force") === "1";
  const cl = chileNow();
  // Minutos desde el corte (los disparos llegan con unos segundos de atraso).
  const since = cl.minutes - slot.min;
  if (!force) {
    if (since < 0 || since >= WINDOW_MIN) {
      return NextResponse.json({ skipped: `Fuera de la ventana del corte ${slot.label} (${since} min)` });
    }
    if (!isBusinessDay(cl.day)) return NextResponse.json({ skipped: `No es día hábil (${cl.day})` });
    if (await wasReportSent(cl.day, slotKey)) {
      return NextResponse.json({ skipped: `El corte ${slot.label} de hoy ya se envió` });
    }
  }

  // Aviso de atraso solo si hubo una falla registrada antes de este intento.
  const prevFailure = since >= ON_TIME_MIN ? await lastReportFailure(cl.day, slotKey) : null;
  const notice = prevFailure ? delayNotice(slot.label, failureCause(prevFailure)) : undefined;
  try {
    const sent = await sendDailySdrReport(slot.label, { notice });
    await markReportSent(cl.day, slotKey);
    return NextResponse.json({ sent, late: !!notice });
  } catch (err) {
    const reason = (err as Error).message || "Error interno";
    console.error(`Error en /api/cron/reporte-sdr (corte ${slot.label}, ${since} min):`, err);
    if (!force) {
      await markReportFailure(cl.day, slotKey, reason);
      // Último disparo de la ventana: avisar (una sola vez).
      if (since >= WINDOW_MIN - STEP_MIN) {
        await sendReportFailureNotice(slot.label, reason).catch((e) => console.error("No se pudo enviar el aviso de falla:", e));
      }
    }
    return NextResponse.json({ error: reason, minutesSinceCut: since }, { status: 500 });
  }
}
