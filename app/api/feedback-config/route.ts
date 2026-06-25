import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  pregunta_calificacion: "¿Cómo calificarías esta reunión?",
  pregunta_empresa:      "¿La empresa es un prospecto calificado?",
  pregunta_contacto:     "¿El contacto era el decisor adecuado?",
  pregunta_propuesta:    "¿Cuál es el próximo paso?",
  pregunta_comentarios:  "Comentarios adicionales",
  razones_no_califica:   ["No tomaba decisiones", "No presentó interés", "No tenía contexto de nosotros", "Tomó la reunión desde el celular", "Otro"],
  propuesta_opciones:    ["Si", "No", "No aún", "Falta otra reunión"],
};

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ config: DEFAULTS });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("feedback_config")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? { ...DEFAULTS, client_id: clientId } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const payload = {
    client_id:             body.client_id,
    pregunta_calificacion: body.pregunta_calificacion ?? DEFAULTS.pregunta_calificacion,
    pregunta_empresa:      body.pregunta_empresa      ?? DEFAULTS.pregunta_empresa,
    pregunta_contacto:     body.pregunta_contacto     ?? DEFAULTS.pregunta_contacto,
    pregunta_propuesta:    body.pregunta_propuesta     ?? DEFAULTS.pregunta_propuesta,
    pregunta_comentarios:  body.pregunta_comentarios  ?? DEFAULTS.pregunta_comentarios,
    razones_no_califica:   body.razones_no_califica   ?? DEFAULTS.razones_no_califica,
    propuesta_opciones:    body.propuesta_opciones     ?? DEFAULTS.propuesta_opciones,
    updated_at:            new Date().toISOString(),
  };

  const { error } = await db
    .from("feedback_config")
    .upsert(payload, { onConflict: "client_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
