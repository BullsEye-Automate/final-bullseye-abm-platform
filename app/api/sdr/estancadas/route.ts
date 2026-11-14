import { NextRequest, NextResponse } from "next/server";
import { previewStaleMail, runStaleAlerts } from "@/lib/dashboardSdr/staleAlerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Alerta de cuentas estancadas, con sesión:
//   GET            → correos que se enviarían (destinatarios, asunto, cuántas), sin enviar
//   GET ?html=<n>  → HTML del correo de ese SDR / líder
//   POST           → envía ahora en modo prueba (todo a TEST_RECIPIENT), sin marcar la semana
export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("html");
    if (name) {
      const html = await previewStaleMail(name);
      if (!html) return NextResponse.json({ error: "Sin correo para ese destinatario" }, { status: 404 });
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return NextResponse.json(await runStaleAlerts({ preview: true }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runStaleAlerts({ force: true, testOnly: true }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
