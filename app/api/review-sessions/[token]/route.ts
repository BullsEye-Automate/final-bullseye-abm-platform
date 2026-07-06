import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("review_sessions")
    .select("token, client_name, contacts, created_at, expires_at")
    .eq("token", params.token)
    .single();

  if (error || !data) return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "Este link de revisión ha expirado" }, { status: 410 });
  }

  return NextResponse.json(data);
}
