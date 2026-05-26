import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  // Obtener ID de campaña del cliente
  const db = supabaseAdmin();
  const { data: config, error: configError } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json(
      { error: "No hay campaña configurada en Config. cliente" },
      { status: 400 }
    );
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  let lemRes: Response;
  try {
    lemRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads?limit=100`,
      {
        headers: { Authorization: `Basic ${credentials}` },
        cache: "no-store",
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error de red: ${err?.message ?? "desconocido"}` },
      { status: 502 }
    );
  }

  if (!lemRes.ok) {
    const text = await lemRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Lemlist respondió ${lemRes.status}: ${text.slice(0, 200)}` },
      { status: 400 }
    );
  }

  const leadsData = await lemRes.json();
  // Lemlist puede retornar array directo o { leads: [...] }
  const leads: any[] = Array.isArray(leadsData) ? leadsData : (leadsData.leads ?? []);

  return NextResponse.json({ leads });
}
