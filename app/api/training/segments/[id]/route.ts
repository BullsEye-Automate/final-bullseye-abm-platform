import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("training_segments")
    .select("*, segment_sources(*)")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ segment: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const {
    name, description, routing_hint, email_count, linkedin_msg_count, include_connect_msg,
    message_focus, style_tone, style_rules, style_avoid, style_email_length,
  } = body;

  const update: Record<string, unknown> = {};
  if (name               !== undefined) update.name               = name;
  if (description        !== undefined) update.description        = description;
  if (routing_hint       !== undefined) update.routing_hint       = routing_hint;
  if (email_count        !== undefined) update.email_count        = email_count;
  if (linkedin_msg_count !== undefined) update.linkedin_msg_count = linkedin_msg_count;
  if (include_connect_msg !== undefined) update.include_connect_msg = include_connect_msg;
  if (message_focus      !== undefined) update.message_focus      = message_focus;
  if (style_tone         !== undefined) update.style_tone         = style_tone;
  if (style_rules        !== undefined) update.style_rules        = style_rules;
  if (style_avoid        !== undefined) update.style_avoid        = style_avoid;
  if (style_email_length !== undefined) update.style_email_length = style_email_length;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("training_segments")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segment: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { error } = await db.from("training_segments").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
