import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  const desde    = searchParams.get("desde");
  const hasta    = searchParams.get("hasta");

  let query = supabase
    .from("meetings")
    .select(`*, meeting_feedback(*)`)
    .order("fecha_reunion", { ascending: false });

  if (clientId && clientId !== "all") query = query.eq("client_id", clientId);
  if (desde) query = query.gte("fecha_reunion", desde);
  if (hasta) query = query.lte("fecha_reunion", hasta);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();
  const body = await req.json();
  const { data, error } = await supabase
    .from("meetings")
    .insert({
      client_id:       body.client_id,
      empresa:         body.empresa,
      contacto_nombre: body.contacto_nombre,
      contacto_cargo:  body.contacto_cargo,
      fecha_reunion:   body.fecha_reunion,
      realizado:       body.realizado ?? "Pendiente",
      notas:           body.notas,
      sdr_nombre:      body.sdr_nombre,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
