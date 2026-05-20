import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_ai_context")
    .select("id, file_name, file_type, content, uploaded_at")
    .eq("client_id", params.id)
    .order("uploaded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.file_name?.trim()) {
    return NextResponse.json({ error: "file_name es obligatorio" }, { status: 400 });
  }
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: "content no puede estar vacío" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_ai_context")
    .insert({
      client_id: params.id,
      file_name: body.file_name.trim(),
      file_type: body.file_type ?? "otro",
      content:   body.content.trim()
    })
    .select("id, file_name, file_type, content, uploaded_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data }, { status: 201 });
}
