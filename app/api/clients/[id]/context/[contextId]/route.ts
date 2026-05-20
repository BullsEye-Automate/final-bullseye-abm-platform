import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; contextId: string } }
) {
  const body = await req.json().catch(() => null);
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: "content no puede estar vacío" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_ai_context")
    .update({
      file_name: body.file_name ?? undefined,
      content:   body.content.trim()
    })
    .eq("id", params.contextId)
    .eq("client_id", params.id)
    .select("id, file_name, file_type, content, uploaded_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; contextId: string } }
) {
  const db = supabaseAdmin();
  const { error } = await db
    .from("client_ai_context")
    .delete()
    .eq("id", params.contextId)
    .eq("client_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
