import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const client_id = body?.client_id;
  if (!client_id) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const sourceId = params.id;

  // Cargar segmento original + sus fuentes
  const [{ data: original }, { data: sources }] = await Promise.all([
    db.from("training_segments").select("*").eq("id", sourceId).eq("client_id", client_id).single(),
    db.from("segment_sources").select("*").eq("segment_id", sourceId),
  ]);

  if (!original) return NextResponse.json({ error: "Segmento no encontrado" }, { status: 404 });

  // Crear nuevo segmento con mismo contenido (incluye guía de estilo)
  const { data: cloned, error } = await db
    .from("training_segments")
    .insert({
      client_id,
      name:               `${original.name} (copia)`,
      description:        original.description,
      routing_hint:       original.routing_hint,
      email_count:        original.email_count,
      linkedin_msg_count: original.linkedin_msg_count,
      include_connect_msg: original.include_connect_msg,
      message_focus:      original.message_focus ?? null,
      style_tone:         original.style_tone    ?? null,
      style_rules:        original.style_rules   ?? null,
      style_avoid:        original.style_avoid   ?? null,
      style_email_length: original.style_email_length ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Clonar fuentes del segmento original
  if (sources?.length) {
    await db.from("segment_sources").insert(
      sources.map((s) => ({
        segment_id:  cloned.id,
        source_type: s.source_type,
        title:       s.title,
        content:     s.content,
        url:         s.url ?? null,
      }))
    );
  }

  // Devolver segmento clonado con sus fuentes para actualizar el estado del frontend
  const { data: clonedWithSources } = await db
    .from("training_segments")
    .select("*, segment_sources(*)")
    .eq("id", cloned.id)
    .single();

  return NextResponse.json({ segment: clonedWithSources });
}
