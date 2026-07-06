import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.contacts?.length) {
    return NextResponse.json({ error: "contacts es requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("review_sessions")
    .insert({
      client_id:   body.client_id ?? null,
      client_name: body.client_name ?? null,
      contacts:    body.contacts,
    })
    .select("token")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data.token });
}
