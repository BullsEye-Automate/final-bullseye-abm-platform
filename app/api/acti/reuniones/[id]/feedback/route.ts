import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { ActiFeedbackError, saveActiFeedback } from "@/lib/acti/meetings";

export const dynamic = "force-dynamic";

// POST { realizada, perfil_rating (1–5), perfil_ok, oportunidad, comentario } → "Tu feedback"
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await saveActiFeedback(supabaseAdmin(), s.user.clientId, params.id, body, s.user.email)) });
  } catch (e) {
    if (e instanceof ActiFeedbackError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("acti feedback:", e);
    return NextResponse.json({ error: "No se pudo guardar tu feedback" }, { status: 500 });
  }
}
