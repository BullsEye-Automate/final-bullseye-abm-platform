import { NextRequest, NextResponse } from "next/server";
import { buildReportPng, sendDailySdrReport, reportRecipients, delayNotice, markReportSent, wasReportSent, lastReportFailure } from "@/lib/reporteSdr/send";
import { chileToday } from "@/lib/celulasSdr/calendar";

// Corte → clave del registro de envíos que usa el cron.
const SLOT_OF: Record<string, string> = { "13:00": "13", "18:30": "18" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vista previa y envío manual del Reporte SDR diario (requiere sesión del
// equipo: no está en la lista pública de middleware.ts).
// GET  /api/reporte-sdr?corte=18:30  → devuelve el PNG con los datos de ahora.
// POST /api/reporte-sdr?corte=18:30  → lo envía en el momento a los
//      destinatarios configurados (lib/reporteSdr/send.ts). Con
//      &atraso=allo lleva el aviso "Enviado a las HH:MM por una falla en la
//      API de Allo en el horario habitual" (envío excepcional a mano).
function cutFrom(req: NextRequest): string {
  const c = req.nextUrl.searchParams.get("corte") || "";
  return /^\d{1,2}:\d{2}$/.test(c) ? c : "18:30";
}

export async function GET(req: NextRequest) {
  // ?estado=1 → si los cortes de hoy ya se enviaron y el motivo de la última
  // falla registrada por el cron (para diagnosticar sin ver los logs).
  if (req.nextUrl.searchParams.get("estado") === "1") {
    const day = chileToday();
    const slots: Record<string, { sent: boolean; lastFailure: string | null }> = {};
    for (const [label, key] of Object.entries(SLOT_OF)) {
      slots[label] = { sent: await wasReportSent(day, key), lastFailure: await lastReportFailure(day, key) };
    }
    return NextResponse.json({ day, slots });
  }
  try {
    const { png, filename } = await buildReportPng(cutFrom(req));
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error en GET /api/reporte-sdr:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const cut = cutFrom(req);
    const atraso = req.nextUrl.searchParams.get("atraso");
    const notice = atraso ? delayNotice(cut, atraso === "allo" ? "la API de Allo" : "la generación del reporte") : undefined;
    const sent = await sendDailySdrReport(cut, { notice });
    // Un envío manual de un corte cuenta como enviado: así el reintento
    // automático cada 15 min no lo vuelve a mandar.
    if (SLOT_OF[cut]) await markReportSent(chileToday(), SLOT_OF[cut]);
    return NextResponse.json({ sent, recipients: await reportRecipients() });
  } catch (err) {
    console.error("Error en POST /api/reporte-sdr:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
