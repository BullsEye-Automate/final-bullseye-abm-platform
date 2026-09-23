import { NextRequest, NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

// GET ?preview=1  → solo analiza, no escribe nada (para mostrar alerta antes de sync real)
// GET ?full=1     → sync completo (todas las filas, no solo las recientes)
// GET ?days=N     → acota a los últimos N días en vez del default (ej. desde el 1° del mes
//                   en curso, para un botón "Actualizar mes en curso" que responda rápido)
// GET             → sync real, acotado a los últimos 40 días como máximo (ver runMeetingsSync)
const MAX_SYNC_DAYS = 40;

export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const full = req.nextUrl.searchParams.get("full") === "1";
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : MAX_SYNC_DAYS;
  return NextResponse.json(await runMeetingsSync(preview, full ? undefined : days));
}
