import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: devuelve reuniones sin client_id que SÍ tienen feedback guardado
export async function GET() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .select("id, empresa, meeting_feedback(id)")
    .is("client_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conFeedback = (data ?? []).filter(m => {
    const fb = m.meeting_feedback as any[];
    return Array.isArray(fb) ? fb.length > 0 : !!fb;
  });

  return NextResponse.json({ conFeedback: conFeedback.length });
}

// POST: asigna client_id SOLO a las reuniones sin cliente que tienen feedback guardado
export async function POST(req: NextRequest) {
  const { client_id } = await req.json();
  if (!client_id) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const supabase = supabaseAdmin();

  // Primero traemos las reuniones huérfanas con sus meeting_feedback
  const { data, error } = await supabase
    .from("meetings")
    .select("id, meeting_feedback(id)")
    .is("client_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Solo las que tienen feedback real
  const idsConFeedback = (data ?? [])
    .filter(m => {
      const fb = m.meeting_feedback as any[];
      return Array.isArray(fb) ? fb.length > 0 : !!fb;
    })
    .map(m => m.id);

  if (idsConFeedback.length === 0) return NextResponse.json({ recuperadas: 0 });

  const { error: updateError } = await supabase
    .from("meetings")
    .update({ client_id, feedback_status: "con_feedback" })
    .in("id", idsConFeedback);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ recuperadas: idsConFeedback.length });
}
