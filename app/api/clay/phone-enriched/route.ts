import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertHSContact, searchHSContactByBullseyeId, searchHSContact } from "@/lib/hubspot";

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

  const contactId = body.bullseye_contact_id;
  const phoneRaw  = (body.phone ?? "").toString().trim();
  const provider  = (body.provider ?? "none").toString().trim().toLowerCase() || "none";

  // ad_hoc: no hay contact_id, solo loguear (la UI consulta resultado por LinkedIn)
  if (!contactId) {
    return NextResponse.json({ ok: true, mode: "ad_hoc", phone: phoneRaw, provider });
  }

  const db = supabaseAdmin();

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

  // Push a HubSpot
  try {
    const existingId =
      (await searchHSContactByBullseyeId(contact.id)) ??
      (contact.email ? await searchHSContact(contact.email) : null);

    if (existingId || contact.email) {
      await upsertHSContact(
        {
          email:                       contact.email ?? undefined,
          bullseye_contact_id:         contact.id,
          bullseye_telefono_clay:      phoneRaw && provider !== "none" ? phoneRaw : undefined,
          bullseye_clay_phone_provider: provider,
        },
        existingId
      );
    }
  } catch (err: any) {
    console.error("[phone-enriched] HubSpot push error:", err?.message);
  }

  // Encadenar push automático a Lemlist (genera mensajes y crea el lead en la campaña)
  // No bloqueamos: si falla, se puede reintentar manualmente desde /campañas.
  let lemlist_pushed = false;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
    if (baseUrl && contact.client_id) {
      const lemRes = await fetch(`${baseUrl}/api/lemlist/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:   contact.client_id,
          contact_ids: [contact.id],
        }),
      });
      lemlist_pushed = lemRes.ok;
      if (!lemRes.ok) {
        const t = await lemRes.text().catch(() => "");
        console.error("[phone-enriched] Lemlist push error:", lemRes.status, t.slice(0, 150));
      }
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
