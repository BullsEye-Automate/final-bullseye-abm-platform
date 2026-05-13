import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncCalls } from "@/lib/callsSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/calls/sync
// Body opcional: { since_days?: number, max_results?: number, analyze?: boolean }
// Defaults: 30 días, 200 calls, analyze=true.
export async function POST(req: NextRequest) {
  let body: { since_days?: number; max_results?: number; analyze?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const db = supabaseAdmin();
  try {
    const result = await syncCalls(db, {
      sinceDays: body.since_days,
      maxResults: body.max_results,
      analyze: body.analyze
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
