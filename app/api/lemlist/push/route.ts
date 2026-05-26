import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { client_id: string; contact_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.client_id) {
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

  const campaignId = config.lemlist_campaign_id;

  // Obtener contactos a empujar
  let contactsQuery = db
    .from("contacts")
    .select("id, first_name, last_name, email, phone, linkedin_url, company_id")
    .eq("client_id", body.client_id)
    .eq("fit_action", "enrich")
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded");

  if (body.contact_ids && body.contact_ids.length > 0) {
    contactsQuery = contactsQuery.in("id", body.contact_ids);
  }

  // Limitar a 20 contactos por llamada para evitar rate limiting
  contactsQuery = contactsQuery.limit(20);

  const { data: contacts, error: contactsError } = await contactsQuery;

  if (contactsError) {
    return NextResponse.json({ error: contactsError.message }, { status: 500 });
  }

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ pushed: 0, skipped: 0, errors: [] });
  }

  // Obtener empresa de cada contacto (para company_name)
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name")
    .in("id", companyIds);

  const companyNameById = new Map<string, string>(
    (companies ?? []).map((c) => [c.id, c.company_name])
  );

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  let pushed = 0;
  let skipped = 0;
  const errors: { contact_id: string; error: string }[] = [];

  // Procesar todos los contactos en paralelo con Promise.allSettled
  await Promise.allSettled(
    contacts.map(async (contact) => {
      // Sin email: saltar
      if (!contact.email?.trim()) {
        skipped++;
        return;
      }

      const companyName = companyNameById.get(contact.company_id) ?? "";

      const lemlistBody: Record<string, string | undefined> = {
        firstName:    contact.first_name  ?? undefined,
        lastName:     contact.last_name   ?? undefined,
        companyName:  companyName         || undefined,
        linkedinUrl:  contact.linkedin_url ?? undefined,
        phone:        contact.phone       ?? undefined,
      };

      // Eliminar campos undefined para no enviarlos
      Object.keys(lemlistBody).forEach(
        (k) => lemlistBody[k] === undefined && delete lemlistBody[k]
      );

      let lemRes: Response;
      try {
        lemRes = await fetch(
          `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(contact.email)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(lemlistBody),
          }
        );
      } catch (err: any) {
        errors.push({ contact_id: contact.id, error: err?.message ?? "Error de red" });
        return;
      }

      if (!lemRes.ok) {
        const text = await lemRes.text().catch(() => "");
        // 4xx con "already in campaign" no se considera error fatal — se marca como empujado
        if (lemRes.status === 409 || text.toLowerCase().includes("already")) {
          // Ya está en campaña: actualizar fecha de push igualmente
        } else {
          errors.push({
            contact_id: contact.id,
            error: `Lemlist ${lemRes.status}: ${text.slice(0, 150)}`,
          });
          return;
        }
      }

      // Actualizar en Supabase
      await db
        .from("contacts")
        .update({
          lemlist_pushed_at: new Date().toISOString(),
          status: "enriched",
        })
        .eq("id", contact.id);

      pushed++;
    })
  );

  return NextResponse.json({ pushed, skipped, errors });
}
