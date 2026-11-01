import { NextRequest, NextResponse } from "next/server";
import { sendDailySdrReport, markReportSent, wasReportSent, sendReportFailureNotice } from "@/lib/reporteSdr/send";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: Reporte SDR diario por correo (PNG adjunto) a las 13:00 y
// 18:30 de Chile, lunes a viernes hábiles. Vercel agenda en UTC y Chile
// cambia de horario (UTC-3 en verano, UTC-4 en invierno), así que vercel.json
// dispara cada corte en las DOS horas UTC posibles y acá se envía solo la que
// coincide con la hora real de Chile (America/Santiago) — nunca se duplica.
// Parámetros: ?slot=13 | ?slot=18 (el corte). ?force=1 se salta el chequeo
// de hora/día hábil (pruebas manuales con el CRON_SECRET).
//
// Reintento: vercel.json agenda además la hora UTC siguiente. Si el envío de
// la hora del corte falló (p. ej. Allo lento y se acabó el tiempo), una hora
// después se vuelve a intentar; si también falla, se avisa por correo a los
// destinatarios. El registro de lo enviado está en allo_response_cache.
const SLOTS: Record<string, { hour: number; label: string }> = {
  "13": { hour: 13, label: "13:00" },
  "18": { hour: 18, label: "18:30" },
};

function chileNow(now = new Date()): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
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
  // Intento principal a la hora del corte; reintento una hora después solo si
  // el principal no quedó registrado como enviado.
  const isRetry = cl.hour === slot.hour + 1;
  if (!force) {
    if (cl.hour !== slot.hour && !isRetry) {
      return NextResponse.json({ skipped: `Hora de Chile ${cl.hour}:xx no corresponde al corte ${slot.label} ni a su reintento` });
    }
    if (!isBusinessDay(cl.day)) return NextResponse.json({ skipped: `No es día hábil (${cl.day})` });
    if (isRetry && (await wasReportSent(cl.day, slotKey))) {
      return NextResponse.json({ skipped: `El corte ${slot.label} de hoy ya se envió` });
    }
  }

  try {
    const sent = await sendDailySdrReport(slot.label);
    await markReportSent(cl.day, slotKey);
    return NextResponse.json({ sent, retry: isRetry });
  } catch (err) {
    const reason = (err as Error).message || "Error interno";
    console.error(`Error en /api/cron/reporte-sdr (corte ${slot.label}${isRetry ? ", reintento" : ""}):`, err);
    if (isRetry && !force) {
      await sendReportFailureNotice(slot.label, reason).catch((e) => console.error("No se pudo enviar el aviso de falla:", e));
    }
    return NextResponse.json({ error: reason, retry: isRetry }, { status: 500 });
  }
}
