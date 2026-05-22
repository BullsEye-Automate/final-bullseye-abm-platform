import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { clientIdToToken } from "@/lib/form-token";

export const dynamic = "force-dynamic";

// Devuelve la URL del formulario público para un cliente dado.
// El token es determinístico (HMAC del client_id) — no necesita guardarse en BD.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data: client, error } = await db
    .from("clients")
    .select("id, name")
    .eq("id", params.id)
    .single();

  if (error || !client) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const token  = clientIdToToken(client.id);
  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const url    = `${origin}/forms/icp/${token}`;

  return NextResponse.json({ token, url, client_name: client.name });
}
