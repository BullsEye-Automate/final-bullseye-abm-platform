import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("model_training_config")
    .select("style_tone, style_rules, style_avoid, style_email_length")
    .eq("client_id", clientId)
    .maybeSingle();

  // Si hay error (ej. columnas no existen), retornar vacío sin romper
  if (error) console.warn("[style-guide GET]", error.message);

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

  // Intentar upsert con las columnas de estilo
  const { error } = await db
    .from("model_training_config")
    .upsert(
      {
        client_id,
        style_tone:         tone        ?? null,
        style_rules:        rules       ?? null,
        style_avoid:        avoid       ?? null,
        style_email_length: email_length ?? "corto",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" }
    );

  if (error) {
    // Si fallan columnas style_*, intentar solo guardar en columna separada como fallback
    console.error("[style-guide PUT]", error.message);

    // Segundo intento: guardar como JSON en una columna genérica si existe
    const fallback = await db
      .from("model_training_config")
      .upsert(
        { client_id, updated_at: new Date().toISOString() },
        { onConflict: "client_id" }
      );

    if (fallback.error) {
      return NextResponse.json(
        { error: `Error al guardar: ${error.message}. Verifica que la migración "message_examples_migration.sql" fue ejecutada en Supabase.` },
        { status: 500 }
      );
    }

    // El upsert base funcionó pero las columnas de estilo no existen
    return NextResponse.json(
      { error: "Las columnas style_tone, style_rules, style_avoid, style_email_length no existen en model_training_config. Ejecuta la migración en Supabase SQL Editor." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
