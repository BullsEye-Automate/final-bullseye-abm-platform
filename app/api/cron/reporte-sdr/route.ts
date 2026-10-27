import { NextRequest, NextResponse } from "next/server";
import { sendDailySdrReport } from "@/lib/reporteSdr/send";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel Cron: Reporte SDR diario por correo (PNG adjunto) a las 13:00 y
// 18:30 de Chile, lunes a viernes hábiles. Vercel agenda en UTC y Chile
// cambia de horario (UTC-3 en verano, UTC-4 en invierno), así que vercel.json
// dispara cada corte en las DOS horas UTC posibles y acá se envía solo la que
// coincide con la hora real de Chile (America/Santiago) — nunca se duplica.
// Parámetros: ?slot=13 | ?slot=18 (el corte). ?force=1 se salta el chequeo
// de hora/día hábil (pruebas manuales con el CRON_SECRET).
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
  if (!force) {
    if (cl.hour !== slot.hour) {
      return NextResponse.json({ skipped: `Hora de Chile ${cl.hour}:xx ≠ corte ${slot.label} (la otra ejecución UTC es la que envía)` });
    }
    if (!isBusinessDay(cl.day)) return NextResponse.json({ skipped: `No es día hábil (${cl.day})` });
  }

  try {
    return NextResponse.json({ sent: await sendDailySdrReport(slot.label) });
  } catch (err) {
    console.error("Error en /api/cron/reporte-sdr:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
