import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data } = await db
    .from("model_training_config")
    .select("style_tone, style_rules, style_avoid, style_email_length")
    .eq("client_id", clientId)
    .maybeSingle();

  return NextResponse.json({
    style: {
      tone:         data?.style_tone         ?? "",
      rules:        data?.style_rules        ?? "",
      avoid:        data?.style_avoid        ?? "",
      email_length: data?.style_email_length ?? "corto",
    },
  });
}

export async function PUT(req: NextRequest) {
  const { client_id, tone, rules, avoid, email_length } = await req.json();
  if (!client_id) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("model_training_config")
    .upsert(
      {
        client_id,
        style_tone: tone, style_rules: rules, style_avoid: avoid, style_email_length: email_length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
