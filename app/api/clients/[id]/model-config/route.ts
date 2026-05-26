import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("model_training_config")
    .select("*")
    .eq("client_id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("model_training_config")
    .upsert(
      {
        client_id:                      params.id,
        business_description:           body.business_description ?? null,
        target_buyer_persona:           body.target_buyer_persona ?? null,
        value_props:                    body.value_props ?? null,
        talking_points:                 body.talking_points ?? null,
        strong_decision_maker_keywords: body.strong_decision_maker_keywords ?? [],
        exclude_role_keywords:          body.exclude_role_keywords ?? [],
        updated_at:                     new Date().toISOString()
      },
      { onConflict: "client_id" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
