import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH — guardar mensajes generados en un contacto
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const update: Record<string, string | null> = {};
  if (body.email_subject     !== undefined) update.email_subject     = body.email_subject;
  if (body.email_body        !== undefined) update.email_body        = body.email_body;
  if (body.email_subject_2   !== undefined) update.email_subject_2   = body.email_subject_2;
  if (body.email_body_2      !== undefined) update.email_body_2      = body.email_body_2;
  if (body.email_subject_3   !== undefined) update.email_subject_3   = body.email_subject_3;
  if (body.email_body_3      !== undefined) update.email_body_3      = body.email_body_3;
  if (body.linkedin_icebreaker !== undefined) update.linkedin_icebreaker = body.linkedin_icebreaker;
  if (body.connect_message   !== undefined) update.connect_message   = body.connect_message;
  if (body.linkedin_msg_2    !== undefined) update.linkedin_msg_2    = body.linkedin_msg_2;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const db = supabaseAdmin();
  const { error } = await db.from("contacts").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
