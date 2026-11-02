import { NextRequest, NextResponse } from "next/server";
import { buildReportPng, sendDailySdrReport, reportRecipients } from "@/lib/reporteSdr/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vista previa y envío manual del Reporte SDR diario (requiere sesión del
// equipo: no está en la lista pública de middleware.ts).
// GET  /api/reporte-sdr?corte=18:30  → devuelve el PNG con los datos de ahora.
// POST /api/reporte-sdr?corte=18:30  → lo envía en el momento a los
//      destinatarios configurados (lib/reporteSdr/send.ts).
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
    return NextResponse.json({ sent: await sendDailySdrReport(cutFrom(req)), recipients: await reportRecipients() });
  } catch (err) {
    console.error("Error en POST /api/reporte-sdr:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
