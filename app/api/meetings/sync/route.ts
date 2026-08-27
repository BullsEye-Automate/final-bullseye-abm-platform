import { NextRequest, NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

// GET ?preview=1  → solo analiza, no escribe nada (para mostrar alerta antes de sync real)
// GET ?full=1     → sync completo (todas las filas, no solo las recientes)
// GET             → sync real, acotado a los últimos 3 meses (ver runMeetingsSync)
export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const full = req.nextUrl.searchParams.get("full") === "1";
  return NextResponse.json(await runMeetingsSync(preview, full ? undefined : 3));
}
