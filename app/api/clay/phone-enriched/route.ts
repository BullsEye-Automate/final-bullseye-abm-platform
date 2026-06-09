import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertHSContact, upsertHSCompany, searchHSContactByBullseyeId, searchHSContact, searchHSCompany, associateContactCompany } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook entrante de Clay. Lo dispara la HTTP API column de la tabla "Contacts Approved"
// cuando el waterfall termina con un teléfono encontrado (o "none" si todos fallaron).
// Body esperado:
// { bullseye_contact_id: string, client_id?: string, phone: string, provider: string }
export async function POST(req: NextRequest) {
  // Auth
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (expected) {
    const hdr = req.headers.get("x-webhook-secret") ?? "";
    if (hdr !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  // Clay puede enviar campos vacíos como "" en lugar de null — normalizar
  const cleanStr = (v: unknown): string => (v ?? "").toString().trim();
  let contactId         = cleanStr(body.bullseye_contact_id);
  const linkedinUrlRaw  = cleanStr(body.linkedin_url);
  const phoneRaw        = cleanStr(body.phone);
  const provider        = cleanStr(body.provider).toLowerCase() || "none";

  const db = supabaseAdmin();

  // Si no llegó bullseye_contact_id pero sí linkedin_url, intentar resolverlo en Supabase.
  // Esto cubre el caso donde Clay no reenvía el campo correctamente.
  if (!contactId && linkedinUrlRaw) {
    console.log(`[phone-enriched] bullseye_contact_id vacío, buscando por linkedin_url=${linkedinUrlRaw}`);
    const { data: matched } = await db
      .from("contacts")
      .select("id")
      .eq("linkedin_url", linkedinUrlRaw)
      .order("clay_phone_requested_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (matched?.id) {
      contactId = matched.id;
      console.log(`[phone-enriched] resuelto contactId=${contactId} desde linkedin_url`);
    }
  }

  // Sigue siendo ad-hoc: guardar en phone_lookups (para UI de /telefonos) y retornar
  if (!contactId) {
    if (linkedinUrlRaw) {
      await db.from("phone_lookups").insert({
        linkedin_url: linkedinUrlRaw,
        phone:        phoneRaw && provider !== "none" ? phoneRaw : null,
        provider,
        source:       "clay",
        client_id:    body.client_id ?? null,
      });
    }
    console.log(`[phone-enriched] ad_hoc lookup guardado, linkedin=${linkedinUrlRaw}`);
    return NextResponse.json({ ok: true, mode: "ad_hoc", phone: phoneRaw, provider });
  }

  // Buscar contacto
  const { data: contact } = await db
    .from("contacts")
    .select("id, client_id, email, phone, phone_source")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) {
    return NextResponse.json({ error: "Contact not found", contact_id: contactId }, { status: 404 });
  }

  // Actualizar Supabase
  const update: Record<string, string | null> = {
    clay_phone_provider:     provider,
    clay_phone_received_at:  new Date().toISOString(),
  };
  if (phoneRaw && provider !== "none") {
    update.phone_clay = phoneRaw;
    // Si el contacto aún no tiene phone principal, usar este como default
    if (!contact.phone) {
      update.phone        = phoneRaw;
      update.phone_source = "clay";
    }
  }

  await db.from("contacts").update(update).eq("id", contactId);

  // Cargar más datos del contacto para enriquecer la creación en HubSpot
  const { data: contactFull } = await db
    .from("contacts")
    .select("id, client_id, first_name, last_name, job_title, email, phone, linkedin_url, company_id")
    .eq("id", contactId)
    .maybeSingle();

  console.log(`[phone-enriched] contactId=${contactId} email=${contactFull?.email ?? "null"} linkedin=${contactFull?.linkedin_url ?? "null"} phone_clay=${phoneRaw}`);

  // Buscar empresa asociada para crearla/asociarla en HubSpot
  let company: { id: string; company_name: string | null; fit_signals: string | null } | null = null;
  if (contactFull?.company_id) {
    const { data } = await db
      .from("companies")
      .select("id, company_name, fit_signals")
      .eq("id", contactFull.company_id)
      .maybeSingle();
    company = data;
  }

  // Push a HubSpot (crear o actualizar — siempre, aunque no haya email)
  try {
    const existingId =
      (await searchHSContactByBullseyeId(contact.id)) ??
      (contactFull?.email ? await searchHSContact(contactFull.email) : null);

    const hsProps: Record<string, string | undefined> = {
      email:                        contactFull?.email      ?? undefined,
      firstname:                    contactFull?.first_name ?? undefined,
      lastname:                     contactFull?.last_name  ?? undefined,
      jobtitle:                     contactFull?.job_title  ?? undefined,
      hs_linkedin_url:              contactFull?.linkedin_url ?? undefined,
      bullseye_contact_id:          contact.id,
      bullseye_telefono_clay:       phoneRaw && provider !== "none" ? phoneRaw : undefined,
      bullseye_clay_phone_provider: provider,
    };

    const hsId = await upsertHSContact(hsProps, existingId);
    console.log(`[phone-enriched] HubSpot upsert contact → hsId=${hsId ?? "null"} (existing=${!!existingId})`);

    // Asociar empresa en HubSpot
    if (hsId && company?.company_name) {
      try {
        const existingCompanyId = await searchHSCompany(company.company_name);
        const hsCompanyId = await upsertHSCompany(
          {
            name:                 company.company_name,
            bullseye_company_id:  company.id,
            bullseye_fit_signals: company.fit_signals ?? undefined,
          },
          existingCompanyId
        );
        if (hsCompanyId) {
          await associateContactCompany(hsId, hsCompanyId);
          console.log(`[phone-enriched] HubSpot company asociada → hsCompanyId=${hsCompanyId} name=${company.company_name}`);
        }
      } catch (err: any) {
        console.error("[phone-enriched] HubSpot company association error:", err?.message);
      }
    }
  } catch (err: any) {
    console.error("[phone-enriched] HubSpot push error:", err?.message);
  }

  // Encadenar push automático a Lemlist (genera mensajes y crea el lead en la campaña)
  let lemlist_pushed = false;
  let lemlist_response: any = null;
  try {
    const clientIdForLemlist = contact.client_id ?? contactFull?.client_id;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");

    console.log(`[phone-enriched] Lemlist push attempt: baseUrl=${baseUrl} client_id=${clientIdForLemlist}`);

    if (!baseUrl)              console.error("[phone-enriched] no baseUrl");
    if (!clientIdForLemlist)   console.error("[phone-enriched] no client_id en contacto");

    if (baseUrl && clientIdForLemlist) {
      const lemRes = await fetch(`${baseUrl}/api/lemlist/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:   clientIdForLemlist,
          contact_ids: [contact.id],
        }),
      });
      const t = await lemRes.text().catch(() => "");
      lemlist_pushed = lemRes.ok;
      try { lemlist_response = JSON.parse(t); } catch { lemlist_response = t.slice(0, 300); }
      console.log(`[phone-enriched] Lemlist push → status=${lemRes.status} pushed=${lemlist_response?.pushed} skipped=${lemlist_response?.skipped} reason=${lemlist_response?.reason} errors=${JSON.stringify(lemlist_response?.errors ?? []).slice(0, 200)}`);
    }
  } catch (err: any) {
    console.error("[phone-enriched] Lemlist push exception:", err?.message);
  }

  return NextResponse.json({
    ok: true,
    contact_id: contactId,
    phone: phoneRaw,
    provider,
    lemlist_pushed,
  });
}
