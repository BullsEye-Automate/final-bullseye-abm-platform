import { NextRequest, NextResponse } from "next/server";
import { runMeetingsSync } from "@/lib/syncMeetings";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  return NextResponse.json(await runMeetingsSync());
}
