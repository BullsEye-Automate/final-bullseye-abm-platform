import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactsToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { client_id: string; contact_ids?: string[]; force_regenerate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { status, result } = await pushContactsToLemlist(db, body);
  return NextResponse.json(result, { status });
}
