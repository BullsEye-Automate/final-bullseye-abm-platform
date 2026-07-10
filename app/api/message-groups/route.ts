import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/message-groups?client_id=
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_groups")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/message-groups — crear grupo
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id || !body?.name) {
    return NextResponse.json({ error: "client_id y name son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_groups")
    .insert({
      client_id:         body.client_id,
      name:              body.name,
      segment_id:        body.segment_id        ?? null,
      segment_name:      body.segment_name      ?? null,
      use_deep_research: body.use_deep_research ?? false,
      total_contacts:    body.total_contacts    ?? 0,
      status:            "generating",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
