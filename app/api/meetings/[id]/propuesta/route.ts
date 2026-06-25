import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.propuesta_comercial) return NextResponse.json({ error: "propuesta_comercial requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("meeting_feedback")
    .update({ propuesta_comercial: body.propuesta_comercial })
    .eq("meeting_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
