import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("training_segments")
    .select("*, segment_sources(*)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segments: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_id, name, description, routing_hint, email_count, linkedin_msg_count, include_connect_msg } = body;

  if (!client_id || !name?.trim()) {
    return NextResponse.json({ error: "Se requiere client_id y name" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("training_segments")
    .insert({
      client_id,
      name: name.trim(),
      description: description ?? null,
      routing_hint: routing_hint ?? "",
      email_count:         email_count         ?? 3,
      linkedin_msg_count:  linkedin_msg_count  ?? 2,
      include_connect_msg: include_connect_msg ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segment: data });
}
