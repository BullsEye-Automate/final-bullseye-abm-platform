import { NextRequest, NextResponse } from "next/server";
import { buildReportPng, sendDailySdrReport, reportRecipients, delayNotice } from "@/lib/reporteSdr/send";

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
    return NextResponse.json({ sent: await sendDailySdrReport(cut, { notice }), recipients: await reportRecipients() });
  } catch (err) {
    console.error("Error en POST /api/reporte-sdr:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
