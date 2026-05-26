import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const limit    = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  const db = supabaseAdmin();

  // Obtener la campaña principal del cliente
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

  // Obtener actividad de respuestas desde Lemlist
  let lemRes: Response;
  try {
    lemRes = await fetch(
      `https://api.lemlist.com/api/activities?type=emailsReplied&campaignId=${config.lemlist_campaign_id}&limit=${limit}`,
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

  const activitiesData = await lemRes.json();
  const activities: any[] = Array.isArray(activitiesData)
    ? activitiesData
    : (activitiesData.data ?? activitiesData.activities ?? []);

  if (activities.length === 0) {
    return NextResponse.json({ replies: [] });
  }

  // Obtener emails únicos para buscar en Supabase
  const emails = [
    ...new Set(
      activities
        .map((a) => a.email?.trim() ?? a.leadEmail?.trim())
        .filter(Boolean) as string[]
    ),
  ];

  // Buscar contactos en Supabase por email
  const { data: contacts } = await db
    .from("contacts")
    .select("id, email, first_name, last_name, job_title, status, company_id")
    .eq("client_id", clientId)
    .in("email", emails);

  const contactByEmail = new Map<string, any>(
    (contacts ?? []).map((c) => [c.email?.toLowerCase(), c])
  );

  // Obtener nombres de empresas para los contactos encontrados
  const companyIds = [
    ...new Set(
      (contacts ?? []).map((c) => c.company_id).filter(Boolean) as string[]
    ),
  ];

  let companyNameById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await db
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds);

    companyNameById = new Map(
      (companies ?? []).map((c) => [c.id, c.company_name])
    );
  }

  // Construir lista de respuestas enriquecidas
  const replies = activities.map((a) => {
    const email = (a.email?.trim() ?? a.leadEmail?.trim() ?? "").toLowerCase();
    const contact = contactByEmail.get(email);

    const companyName =
      contact
        ? (companyNameById.get(contact.company_id) ?? a.companyName ?? a.companyDomain ?? "")
        : (a.companyName ?? a.companyDomain ?? "");

    return {
      activity_id:    a._id ?? a.id ?? null,
      email:          email || null,
      first_name:     contact?.first_name ?? a.firstName ?? null,
      last_name:      contact?.last_name  ?? a.lastName  ?? null,
      company_name:   companyName || null,
      text:           a.text ?? a.body ?? null,
      created_at:     a.createdAt ?? a.date ?? null,
      contact_id:     contact?.id ?? null,
      contact_status: contact?.status ?? null,
      job_title:      contact?.job_title ?? null,
    };
  });

  return NextResponse.json({ replies });
}
