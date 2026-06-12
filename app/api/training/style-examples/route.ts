import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — listar ejemplos globales de estilo
export async function GET(req: NextRequest) {
  const client_id = req.nextUrl.searchParams.get("client_id");
  if (!client_id) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_examples")
    .select("id, email_subject, email_body, contact_name, job_title, created_at")
    .eq("client_id", client_id)
    .is("segment_id", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ examples: data ?? [] });
}

// POST — guardar nuevo ejemplo de estilo
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id || !body?.email_subject || !body?.email_body) {
    return NextResponse.json({ error: "client_id, email_subject y email_body son requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_examples")
    .insert({
      client_id:     body.client_id,
      email_subject: body.email_subject,
      email_body:    body.email_body,
      contact_name:  body.contact_name  ?? null,
      job_title:     body.job_title     ?? null,
      segment_id:    null,
    })
    .select("id, email_subject, email_body, contact_name, job_title, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ example: data });
}

// DELETE — eliminar ejemplo
export async function DELETE(req: NextRequest) {
  const id        = req.nextUrl.searchParams.get("id");
  const client_id = req.nextUrl.searchParams.get("client_id");
  if (!id || !client_id) return NextResponse.json({ error: "id y client_id requeridos" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("message_examples")
    .delete()
    .eq("id", id)
    .eq("client_id", client_id)
    .is("segment_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
