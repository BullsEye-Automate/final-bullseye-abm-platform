// Orquestador del phone enrichment. Sprint 4 fase 2.
//
// Flujo (mismo para hot leads automáticos y para SDR manual):
//   1. Si contacts.phone ya está set → no-op, marcar status='done_lemlist'
//      (o lo que esté). Idempotente.
//   2. GET Lemlist lead (por email o por id) → si trae phone, usar.
//   3. Fallback Lusha (linkedinUrl preferido, email fallback). Si Lusha
//      trae phone, usar.
//   4. Persistir en Supabase + push a HubSpot.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLemlistLeadByEmail, getLemlistLeadById } from "./lemlist";
import { lookupLushaPerson } from "./lusha";
import { updateObject } from "./hubspot";

export type EnrichResult = {
  contact_id: string;
  ok: boolean;
  status: "done_lemlist" | "done_lusha" | "not_found" | "skipped_already_set";
  phone: string | null;
  source: "lemlist" | "lusha" | null;
  details?: Record<string, unknown>;
};

export async function enrichContactPhone(
  db: SupabaseClient,
  contactId: string
): Promise<EnrichResult> {
  const { data: contact, error } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, email, phone, linkedin_url, company_id, lemlist_lead_id, hubspot_contact_id, phone_enrichment_status"
    )
    .eq("id", contactId)
    .maybeSingle();
  if (error || !contact) {
    return {
      contact_id: contactId,
      ok: false,
      status: "not_found",
      phone: null,
      source: null,
      details: { error: error?.message ?? "Contact not found" }
    };
  }

  // 1) Phone ya seteado → no-op.
  if (contact.phone && contact.phone.trim().length > 4) {
    await markStatus(db, contactId, "done_lemlist", contact.hubspot_contact_id, {
      phone: contact.phone,
      source: contact.phone_enrichment_status?.startsWith("done_lusha")
        ? "lusha"
        : "lemlist"
    });
    return {
      contact_id: contactId,
      ok: true,
      status: "skipped_already_set",
      phone: contact.phone,
      source: null
    };
  }

  // 2) Lemlist primero.
  let phoneFound: string | null = null;
  let sourceFound: "lemlist" | "lusha" | null = null;
  const lemlistDetail: Record<string, unknown> = {};

  // Carga datos de empresa para fallbacks de Lusha por nombre.
  const { data: company } = contact.company_id
    ? await db
        .from("companies")
        .select("company_name")
        .eq("id", contact.company_id)
        .maybeSingle()
    : { data: null as { company_name: string } | null };

  if (contact.lemlist_lead_id || contact.email) {
    const lemRes = contact.lemlist_lead_id
      ? await getLemlistLeadById(contact.lemlist_lead_id)
      : await getLemlistLeadByEmail(
          process.env.LEMLIST_CAMPAIGN_ID ?? "",
          contact.email as string
        );
    lemlistDetail.status = lemRes.status;
    if (lemRes.ok) {
      lemlistDetail.found_phone = !!lemRes.phone;
      if (lemRes.phone) {
        phoneFound = lemRes.phone;
        sourceFound = "lemlist";
      }
    } else {
      lemlistDetail.error = lemRes.error;
    }
    await db
      .from("contacts")
      .update({ lemlist_lookup_at: new Date().toISOString() })
      .eq("id", contactId);
  } else {
    lemlistDetail.skipped = "no lemlist_lead_id and no email";
  }

  // 3) Lusha fallback.
  let lushaDetail: Record<string, unknown> | undefined;
  if (!phoneFound && (contact.linkedin_url || contact.email)) {
    const lushaRes = await lookupLushaPerson({
      linkedinUrl: contact.linkedin_url,
      email: contact.email,
      firstName: contact.first_name,
      lastName: contact.last_name,
      companyName: company?.company_name ?? null
    });
    lushaDetail = { status: lushaRes.status };
    if (lushaRes.ok) {
      lushaDetail.found_phone = !!lushaRes.phone;
      lushaDetail.found_mobile = !!lushaRes.mobile;
      if (lushaRes.phone) {
        phoneFound = lushaRes.phone;
        sourceFound = "lusha";
      }
    } else {
      lushaDetail.error = lushaRes.error;
    }
    await db
      .from("contacts")
      .update({ lusha_lookup_at: new Date().toISOString() })
      .eq("id", contactId);
  }

  // 4) Persistir resultado.
  if (phoneFound && sourceFound) {
    const status: "done_lemlist" | "done_lusha" =
      sourceFound === "lemlist" ? "done_lemlist" : "done_lusha";
    await db
      .from("contacts")
      .update({
        phone: phoneFound,
        phone_source: sourceFound,
        phone_enriched_at: new Date().toISOString(),
        phone_enrichment_status: status
      })
      .eq("id", contactId);
    await markStatus(db, contactId, status, contact.hubspot_contact_id, {
      phone: phoneFound,
      source: sourceFound
    });
    return {
      contact_id: contactId,
      ok: true,
      status,
      phone: phoneFound,
      source: sourceFound,
      details: { lemlist: lemlistDetail, lusha: lushaDetail }
    };
  }

  await db
    .from("contacts")
    .update({ phone_enrichment_status: "not_found" })
    .eq("id", contactId);
  await markStatus(db, contactId, "not_found", contact.hubspot_contact_id, {});
  return {
    contact_id: contactId,
    ok: false,
    status: "not_found",
    phone: null,
    source: null,
    details: { lemlist: lemlistDetail, lusha: lushaDetail }
  };
}

async function markStatus(
  _db: SupabaseClient,
  _contactId: string,
  status: "done_lemlist" | "done_lusha" | "not_found",
  hubspotContactId: string | null | undefined,
  extra: { phone?: string; source?: "lemlist" | "lusha" }
): Promise<void> {
  if (!hubspotContactId) return;
  const props: Record<string, string | number> = {
    wecad_phone_enrichment_status: status
  };
  if (extra.phone) props.phone = extra.phone;
  if (extra.source) props.wecad_phone_source = extra.source;
  try {
    await updateObject("contacts", hubspotContactId, props);
  } catch {
    // No bloqueamos el flujo si HubSpot falla; el cron próximo va a
    // reintentar si phone_enrichment_status sigue inconsistente.
  }
}
