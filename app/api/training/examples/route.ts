import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_examples")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ examples: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_id, contact_name, job_title, company_name, email_subject, email_body, icebreaker, notes } = body;
  if (!client_id || !email_subject || !email_body) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_examples")
    .insert({ client_id, contact_name, job_title, company_name, email_subject, email_body, icebreaker, notes })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ example: data });
}
