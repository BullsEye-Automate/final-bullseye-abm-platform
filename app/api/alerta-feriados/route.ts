import { NextResponse } from "next/server";
import { buildHolidayReport } from "@/lib/feriados/report";
import { buildHolidayEmail, holidayRecipients, sendHolidayAlert } from "@/lib/feriados/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Alerta de feriados — vista previa y envío manual (requiere sesión del
// equipo: no está en la lista pública de middleware.ts).
// GET  → { report, subject, html, recipients } con los datos de ahora.
// POST → envía el correo en el momento a los destinatarios configurados.
export async function GET() {
  try {
    const report = await buildHolidayReport();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
    const { subject, html } = buildHolidayEmail(report, appUrl);
    return NextResponse.json({ report, subject, html, recipients: await holidayRecipients() });
  } catch (err) {
    console.error("Error en GET /api/alerta-feriados:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST() {
  try {
    return NextResponse.json({ sent: await sendHolidayAlert() });
  } catch (err) {
    console.error("Error en POST /api/alerta-feriados:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
