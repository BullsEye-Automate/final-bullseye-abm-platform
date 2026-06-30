import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { clientIdToToken } from "@/lib/form-token";

export const dynamic = "force-dynamic";

// Devuelve la URL del formulario público para un cliente dado.
// El token es determinístico (HMAC del client_id) — no necesita guardarse en BD.
// Acepta ?industry_id= opcional para generar un link directo a una industria específica.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const industryId = req.nextUrl.searchParams.get("industry_id");
  const db = supabaseAdmin();
  const { data: client, error } = await db
    .from("clients")
    .select("id, name")
    .eq("id", params.id)
    .single();

  if (error || !client) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  // Si se pasa industry_id, validar que pertenece a este cliente
  let industryName: string | null = null;
  if (industryId) {
    const { data: industry } = await db
      .from("icp_industries")
      .select("id, name")
      .eq("id", industryId)
      .eq("client_id", params.id)
      .single();
    if (!industry) {
      return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
    }
    industryName = industry.name;
  }

  const token  = clientIdToToken(client.id);
  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const url    = industryId
    ? `${origin}/forms/icp/${token}?industry_id=${industryId}`
    : `${origin}/forms/icp/${token}`;

  return NextResponse.json({ token, url, client_name: client.name, industry_name: industryName });
}
