import type { SupabaseClient } from "@supabase/supabase-js";

export type PushPhoneOk  = { ok: true;  contact_id: string; requested_at: string };
export type PushPhoneErr = { ok: false; contact_id: string; status: number; error: string };

// Empuja un contacto aprobado a la tabla "Contacts Approved" de Clay para que el waterfall
// (LeadMagic → PDL → upcell → Clay Enrichments → Wiza) busque el teléfono móvil.
// El resultado vuelve vía webhook al endpoint /api/clay/phone-enriched.
export async function pushContactPhoneToClay(
  db: SupabaseClient,
  contactId: string
): Promise<PushPhoneOk | PushPhoneErr> {
  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select("id, client_id, company_id, first_name, last_name, linkedin_url, email")
    .eq("id", contactId)
    .maybeSingle();

  if (cErr || !contact) {
    return { ok: false, contact_id: contactId, status: 404, error: cErr?.message ?? "Contact not found" };
  }
  if (!contact.linkedin_url) {
    return { ok: false, contact_id: contactId, status: 400, error: "Contact has no linkedin_url" };
  }

  const { data: company } = await db
    .from("companies")
    .select("company_name")
    .eq("id", contact.company_id)
    .maybeSingle();

  const webhookUrl = process.env.CLAY_CONTACTS_APPROVED_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, contact_id: contactId, status: 500, error: "CLAY_CONTACTS_APPROVED_WEBHOOK_URL no configurado" };
  }

  const payload = {
    bullseye_contact_id: contact.id,
    client_id:           contact.client_id,
    linkedin_url:        contact.linkedin_url,
    first_name:          contact.first_name  ?? null,
    last_name:           contact.last_name   ?? null,
    company_name:        company?.company_name ?? null,
    email:               contact.email       ?? null,
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (!res?.ok) {
    return {
      ok: false,
      contact_id: contactId,
      status: res?.status ?? 502,
      error: `Clay webhook ${res?.status ?? "no-response"}`,
    };
  }

  const requested_at = new Date().toISOString();
  await db.from("contacts").update({ clay_phone_requested_at: requested_at }).eq("id", contactId);

  return { ok: true, contact_id: contactId, requested_at };
}
