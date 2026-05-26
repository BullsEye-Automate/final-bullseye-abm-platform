// Empuja contactos aprobados a la campaña de Lemlist correspondiente al cliente.
// Multi-tenant: usa getClientLemlistCampaignId para resolver la campaña por cliente.

import { supabaseAdmin } from "@/lib/supabase";
import { addLeadToLemlistCampaign } from "@/lib/lemlist";
import { getClientLemlistCampaignId } from "@/lib/lemlistCampaigns";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

export type LemlistPushResult =
  | { ok: true; leadId: string; contactId: string }
  | { ok: false; error: string; contactId: string };

/**
 * Empuja un contacto aprobado a la campaña de Lemlist del cliente.
 * Actualiza lemlist_lead_id, lemlist_pushed_at o lemlist_push_error en Supabase.
 */
export async function pushApprovedToLemlist(
  contactId: string,
  clientId: string | null | undefined
): Promise<LemlistPushResult> {
  const db = supabaseAdmin();

  // Cargar el contacto con datos de empresa
  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, email, phone, linkedin_url, job_title, company_id, " +
        "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status"
    )
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr || !contact) {
    return {
      ok: false,
      error: contactErr?.message ?? "Contacto no encontrado",
      contactId,
    };
  }

  // Cargar empresa
  const { data: company } = await db
    .from("companies")
    .select("company_name, client_id")
    .eq("id", contact.company_id)
    .maybeSingle();

  // Resolver campaña por cliente (multi-tenant)
  const resolvedClientId = clientId ?? company?.client_id ?? null;
  const campaignId = await getClientLemlistCampaignId(db, resolvedClientId);

  if (!campaignId) {
    const err = "No hay campaña de Lemlist configurada para este cliente";
    await db
      .from("contacts")
      .update({ lemlist_push_error: err })
      .eq("id", contactId);
    return { ok: false, error: err, contactId };
  }

  // Normalizar LinkedIn URL
  const linkedinUrl = contact.linkedin_url
    ? normalizeLinkedInUrl(contact.linkedin_url)
    : null;

  // Elegir icebreaker según si tiene email o no
  const icebreaker = contact.email
    ? (contact.linkedin_icebreaker ?? null)
    : (contact.linkedin_icebreaker ?? null);

  const result = await addLeadToLemlistCampaign(campaignId, {
    email: contact.email ?? undefined,
    firstName: contact.first_name ?? undefined,
    lastName: contact.last_name ?? undefined,
    companyName: company?.company_name ?? undefined,
    linkedinUrl: linkedinUrl ?? undefined,
    phone: contact.phone ?? undefined,
    icebreaker: icebreaker ?? undefined,
    bullseye_fit_score: contact.fit_score ?? undefined,
    bullseye_fit_reason: contact.fit_reason ?? undefined,
    bullseye_fit_action: contact.fit_action ?? undefined,
  });

  if (!result.ok) {
    await db
      .from("contacts")
      .update({
        lemlist_push_error: result.error,
        lemlist_pushed_at: new Date().toISOString(),
      })
      .eq("id", contactId);
    return { ok: false, error: result.error, contactId };
  }

  // Actualizar con lead ID y estado
  await db
    .from("contacts")
    .update({
      lemlist_lead_id: result.leadId || null,
      lemlist_pushed_at: new Date().toISOString(),
      lemlist_push_error: null,
      status: "enriched",
    })
    .eq("id", contactId);

  return { ok: true, leadId: result.leadId, contactId };
}
