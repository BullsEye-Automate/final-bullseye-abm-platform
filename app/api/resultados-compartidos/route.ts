import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.client_id) {
    return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("resultados_share_links")
    .insert({
      client_id: body.client_id,
      desde: body.desde || null,
      hasta: body.hasta || null,
    })
    .select("token")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data.token });
}
