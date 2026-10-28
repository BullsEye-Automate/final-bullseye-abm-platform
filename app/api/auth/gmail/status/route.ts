import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getUserIdFromRequest } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ connected: false });

  const db = supabaseAdmin();
  const { data } = await db
    .from("user_gmail_tokens")
    .select("email")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({
    connected: !!data,
    email: data?.email ?? null,
    userId,
  });
}
