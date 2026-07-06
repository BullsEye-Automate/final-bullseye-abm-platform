import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertHSContact,
  upsertHSCompany,
  searchHSContactByBullseyeId,
  searchHSContact,
  searchHSCompany,
  associateContactCompany,
} from "./hubspot";

// Crea o actualiza un contacto y su empresa en HubSpot a partir del registro de Supabase.
// Usado en dos lugares: (a) bypass al aprobar contactos sin esperar Clay,
// (b) callback de Clay /api/clay/phone-enriched cuando llega el teléfono.
export async function syncContactToHubSpot(
  db: SupabaseClient,
  contactId: string,
  extraProps: Record<string, string | undefined> = {}
): Promise<{ ok: boolean; hsId?: string; error?: string }> {
  const { data: contact } = await db
    .from("contacts")
    .select("id, client_id, first_name, last_name, job_title, email, phone, phone_clay, phone_lusha, linkedin_url, company_id, fit_score")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) return { ok: false, error: "Contact not found" };

  let company: { id: string; company_name: string | null; fit_signals: string | null } | null = null;
  if (contact.company_id) {
    const { data } = await db
      .from("companies")
      .select("id, company_name, fit_signals")
      .eq("id", contact.company_id)
      .maybeSingle();
    company = data;
  }

  try {
    const existingId =
      (await searchHSContactByBullseyeId(contact.id)) ??
      (contact.email ? await searchHSContact(contact.email) : null);

    const hsProps: Record<string, string | number | undefined> = {
      email:                   contact.email        ?? undefined,
      firstname:               contact.first_name   ?? undefined,
      lastname:                contact.last_name    ?? undefined,
      jobtitle:                contact.job_title    ?? undefined,
      hs_linkedin_url:         contact.linkedin_url ?? undefined,
      phone:                   contact.phone        ?? undefined,
      bullseye_contact_id:     contact.id,
      bullseye_telefono_clay:  contact.phone_clay   ?? undefined,
      bullseye_telefono_lusha: contact.phone_lusha  ?? undefined,
      bullseye_fit_score:      contact.fit_score    ?? undefined,
      ...extraProps,
    };

    const hsId = await upsertHSContact(hsProps, existingId);
    if (!hsId) return { ok: false, error: "HubSpot upsert returned null" };

    // Asociar empresa
    if (company?.company_name) {
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
        if (hsCompanyId) await associateContactCompany(hsId, hsCompanyId);
      } catch (err: any) {
        console.error(`[syncContactToHubSpot] company association error:`, err?.message);
      }
    }

    return { ok: true, hsId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "HubSpot error" };
  }
}
