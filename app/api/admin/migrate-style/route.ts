import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint temporal: migra la guía de estilo global de un cliente al segmento indicado
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { client_id, segment_name } = body ?? {};
  if (!client_id || !segment_name) {
    return NextResponse.json({ error: "client_id y segment_name requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // 1. Leer guía de estilo global
  const { data: config, error: e1 } = await db
    .from("model_training_config")
    .select("style_tone, style_rules, style_avoid, style_email_length")
    .eq("client_id", client_id)
    .maybeSingle();

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!config) return NextResponse.json({ error: "No hay guía de estilo global para este cliente" }, { status: 404 });

  // 2. Buscar el segmento por nombre (parcial, sin distinción de mayúsculas)
  const { data: segments, error: e2 } = await db
    .from("training_segments")
    .select("id, name, style_tone, style_rules, style_avoid, style_email_length")
    .eq("client_id", client_id)
    .ilike("name", `%${segment_name}%`);

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  if (!segments?.length) return NextResponse.json({ error: `No se encontró segmento con nombre similar a "${segment_name}"` }, { status: 404 });

  // 3. Actualizar el primer segmento encontrado
  const seg = segments[0];
  const { error: e3 } = await db
    .from("training_segments")
    .update({
      style_tone:         config.style_tone,
      style_rules:        config.style_rules,
      style_avoid:        config.style_avoid,
      style_email_length: config.style_email_length ?? "corto",
    })
    .eq("id", seg.id);

  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    segment_id:   seg.id,
    segment_name: seg.name,
    migrated: {
      style_tone:         config.style_tone,
      style_rules:        config.style_rules,
      style_avoid:        config.style_avoid,
      style_email_length: config.style_email_length,
    },
  });
}
