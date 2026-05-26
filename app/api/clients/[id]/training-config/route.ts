import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("model_training_config")
    .select("*")
    .eq("is_active", true)
    .eq("client_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const db = supabaseAdmin();

  // Desactivar config anterior de este cliente
  await db
    .from("model_training_config")
    .update({ is_active: false })
    .eq("client_id", params.id)
    .eq("is_active", true);

  const { data, error } = await db
    .from("model_training_config")
    .insert({
      client_id:                     params.id,
      is_active:                     true,
      language:                      body.language                      ?? "es",
      register:                      body.register                      ?? null,
      icebreaker_max_chars:          body.icebreaker_max_chars          ?? 180,
      subject_max_words:             body.subject_max_words             ?? 7,
      body_max_words:                body.body_max_words                ?? null,
      value_props:                   body.value_props                   ?? [],
      talking_points:                body.talking_points                ?? [],
      forbidden_phrases:             body.forbidden_phrases             ?? [],
      required_phrases:              body.required_phrases              ?? [],
      strong_decision_maker_keywords: body.strong_decision_maker_keywords ?? [],
      exclude_role_keywords:         body.exclude_role_keywords         ?? [],
      notes:                         body.notes                         ?? null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
