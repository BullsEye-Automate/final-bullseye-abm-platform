import { NextRequest, NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  // ?sinceDays=N: sync incremental (solo filas recientes, sin borrar
  // huérfanas). Lo usa el cron horario en horario laboral; el cron de la
  // noche corre sin parámetro (sync completo).
  const sinceDays = Number(req.nextUrl.searchParams.get("sinceDays")) || undefined;
  return NextResponse.json(await runMeetingsSync(false, sinceDays));
}
