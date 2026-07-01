import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: devuelve cuántas reuniones tienen client_id = null
export async function GET() {
  const supabase = supabaseAdmin();
  const { count, error } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .is("client_id", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ huerfanas: count ?? 0 });
}

// POST: asigna client_id a todas las reuniones que tienen client_id = null
export async function POST(req: NextRequest) {
  const { client_id } = await req.json();
  if (!client_id) return NextResponse.json({ error: "client_id requerido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .update({ client_id })
    .is("client_id", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actualizadas: data?.length ?? 0 });
}
