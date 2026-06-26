import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { client_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body vacío es aceptable
  }

  if (!body.client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, body.client_id);
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  // Obtener la campaña principal del cliente
  const { data: config, error: configError } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", body.client_id)
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

  // Obtener leads de la campaña desde Lemlist
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

  // Filtrar leads con phone y email
  const leadsWithPhone = leads.filter(
    (l) => l.phone?.trim() && (l.email?.trim() ?? l.leadEmail?.trim())
  );

  if (leadsWithPhone.length === 0) {
    return NextResponse.json({ refreshed: 0 });
  }

  let refreshed = 0;

  await Promise.allSettled(
    leadsWithPhone.map(async (lead) => {
      const email = lead.email?.trim() ?? lead.leadEmail?.trim();
      const phone = lead.phone.trim();

      if (!email) return;

      // Buscar contacto en Supabase por email y actualizar phone si está vacío
      const { data: contact } = await db
        .from("contacts")
        .select("id, phone")
        .eq("client_id", body.client_id!)
        .eq("email", email)
        .maybeSingle();

      if (!contact) return;

      // Solo actualizar si el teléfono está vacío
      if (contact.phone?.trim()) return;

      const { error: updateError } = await db
        .from("contacts")
        .update({ phone, phone_source: "lemlist" })
        .eq("id", contact.id);

      if (!updateError) refreshed++;
    })
  );

  return NextResponse.json({ refreshed });
}
