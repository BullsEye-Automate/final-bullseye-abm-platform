import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: detecta meetings con feedback guardado pero feedback_status incorrecto
export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");

  let query = supabase
    .from("meetings")
    .select("id, empresa, feedback_status, meeting_feedback(id)")
    .eq("feedback_status", "pendiente");

  if (clientId && clientId !== "__all__") query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Meetings que tienen fila en meeting_feedback pero status sigue en "pendiente"
  const desincronizados = (data ?? []).filter(m => {
    const fb = m.meeting_feedback as any[];
    return Array.isArray(fb) ? fb.length > 0 : !!fb;
  });

  return NextResponse.json({ desincronizados: desincronizados.length });
}

// POST: corrige feedback_status en todos los meetings con feedback guardado
export async function POST(req: NextRequest) {
  const { client_id } = await req.json();
  const supabase = supabaseAdmin();

  let query = supabase
    .from("meetings")
    .select("id, meeting_feedback(id)")
    .eq("feedback_status", "pendiente");

  if (client_id && client_id !== "__all__") query = query.eq("client_id", client_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const idsACorregir = (data ?? [])
    .filter(m => {
      const fb = m.meeting_feedback as any[];
      return Array.isArray(fb) ? fb.length > 0 : !!fb;
    })
    .map(m => m.id);

  if (idsACorregir.length === 0) return NextResponse.json({ corregidos: 0 });

  const { error: updateError } = await supabase
    .from("meetings")
    .update({ feedback_status: "con_feedback" })
    .in("id", idsACorregir);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ corregidos: idsACorregir.length });
}
