import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = supabaseAdmin();

  const { data: link, error: linkError } = await db
    .from("resultados_share_links")
    .select("client_id, desde, hasta")
    .eq("token", params.token)
    .single();

  if (linkError || !link) {
    return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });
  }

  const { data: client } = await db
    .from("clients")
    .select("name, logo_url")
    .eq("id", link.client_id)
    .single();

  // client_id, desde y hasta se resuelven acá desde el token — nunca desde
  // parámetros de la URL, para que el cliente no pueda ver datos de otro.
  let query = db
    .from("meetings")
    .select(`*, meeting_feedback(*)`)
    .eq("client_id", link.client_id)
    .order("fecha_reunion", { ascending: false });

  if (link.desde) query = query.gte("fecha_reunion", link.desde);
  if (link.hasta) query = query.lte("fecha_reunion", link.hasta);

  const { data: meetings, error: meetingsError } = await query;
  if (meetingsError) return NextResponse.json({ error: meetingsError.message }, { status: 500 });

  return NextResponse.json({
    client_name: client?.name ?? null,
    client_logo_url: client?.logo_url ?? null,
    desde: link.desde,
    hasta: link.hasta,
    meetings,
  });
}
