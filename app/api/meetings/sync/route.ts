import { NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

// Ruta interna para el botón del UI — no requiere CRON_SECRET
export async function GET() {
  return NextResponse.json(await runMeetingsSync());
}
