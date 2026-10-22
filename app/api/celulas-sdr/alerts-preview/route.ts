import { NextRequest, NextResponse } from "next/server";
import { buildAllDigests, leaderEmail, sendCellAlerts } from "@/lib/celulasSdr/server/alertsMail";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vista previa del correo diario de alertas (requiere sesión — no está en la
// lista pública del middleware).
// - GET ?leader=<clave>          → HTML del correo de esa líder (o de la primera)
// - GET ?format=json             → asunto, destinatario y resumen de cada líder
// - POST ?leader=<clave>         → envía AHORA en modo prueba (solo a la casilla
//                                  de prueba), aunque no sea día hábil
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const { digests, warnings } = await buildAllDigests();
    if (sp.get("format") === "json") {
      return NextResponse.json({
        warnings,
        leaders: digests.map((d) => ({ key: d.leader.key, name: d.leader.name, to: leaderEmail(d.leader.name), subject: d.subject, summary: d.summary })),
      });
    }
    const d = digests.find((x) => x.leader.key === sp.get("leader")) ?? digests[0];
    if (!d) return NextResponse.json({ error: "No hay células en la Maestra" }, { status: 404 });
    return new NextResponse(d.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const leaderKey = request.nextUrl.searchParams.get("leader") || undefined;
    return NextResponse.json(await sendCellAlerts({ force: true, testOnly: true, leaderKey }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
