import { NextRequest, NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

// GET ?preview=1  → solo analiza, no escribe nada (para mostrar alerta antes de sync real)
// GET             → sync real
export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  return NextResponse.json(await runMeetingsSync(preview));
}
