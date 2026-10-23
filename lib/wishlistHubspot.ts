import type { SupabaseClient } from "@supabase/supabase-js";
import {
  associateContactCompany,
  patchHSContact,
  searchHSCompany,
  searchHSCompanyByDomain,
  searchHSContactByLinkedinUrl,
  upsertHSCompany,
  upsertHSContact,
} from "./hubspot";

// Contactos aprobados de la wishlist → HubSpot de BullsEye.
//  - Empresa: si vino de la base HubSpot se usa ese mismo registro (source_ref
//    = id de HubSpot); si no, se busca por dominio y luego por nombre, y si no
//    existe se crea. El id queda en client_wishlist.hubspot_company_id.
//  - Contacto: se busca por LinkedIn y se crea o actualiza con las propiedades
//    bullseye_* (cliente, fit, estado) y el owner del cliente; se asocia a la
//    empresa. Cuando Lemlist entrega email / teléfono se actualiza.

export async function pushContactToHubspot(db: SupabaseClient, contactId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await db
    .from("wishlist_contacts")
    .select("id, client_id, wishlist_id, first_name, last_name, title, linkedin_url, seniority, fit_score, email, phone, hubspot_contact_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Contacto no encontrado" };

  const [{ data: item }, { data: client }, { data: config }] = await Promise.all([
    db.from("client_wishlist").select("id, company_name, domain, source, source_ref, hubspot_company_id").eq("id", c.wishlist_id).maybeSingle(),
    db.from("clients").select("name").eq("id", c.client_id).maybeSingle(),
    db.from("client_configs").select("hubspot_owner_id").eq("client_id", c.client_id).maybeSingle(),
  ]);

  try {
    // Empresa
    let companyId: string | null = item?.hubspot_company_id ?? null;
    if (!companyId && item) {
      companyId =
        (item.source === "hubspot" ? item.source_ref : null) ??
        (item.domain ? await searchHSCompanyByDomain(item.domain) : null) ??
        (await searchHSCompany(item.company_name));
      if (!companyId) companyId = await upsertHSCompany({ name: item.company_name, domain: item.domain, bullseye_company_id: item.id });
      if (companyId) await db.from("client_wishlist").update({ hubspot_company_id: companyId }).eq("id", item.id);
    }

    // Contacto
    const existing = c.hubspot_contact_id ?? (c.linkedin_url ? await searchHSContactByLinkedinUrl(c.linkedin_url) : null);
    const hsContactId = await upsertHSContact(
      {
        firstname: c.first_name,
        lastname: c.last_name,
        jobtitle: c.title,
        hs_linkedin_url: c.linkedin_url,
        email: c.email,
        phone: c.phone,
        bullseye_contact_id: c.id,
        bullseye_client_name: client?.name,
        bullseye_seniority: c.seniority,
        bullseye_fit_score: c.fit_score,
        bullseye_status: "approved",
        ...(config?.hubspot_owner_id ? { hubspot_owner_id: config.hubspot_owner_id } : {}),
      },
      existing
    );
    if (hsContactId && companyId) await associateContactCompany(hsContactId, companyId);
    await db.from("wishlist_contacts").update({ hubspot_contact_id: hsContactId, hubspot_error: null }).eq("id", c.id);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.from("wishlist_contacts").update({ hubspot_error: msg.slice(0, 500) }).eq("id", c.id);
    return { ok: false, error: msg };
  }
}

// Email / teléfono que llegó del enriquecimiento de Lemlist
export async function updateHubspotContactData(
  db: SupabaseClient,
  row: { id: string; hubspot_contact_id: string | null },
  data: { email: string | null; phone: string | null }
): Promise<void> {
  if (!row.hubspot_contact_id || (!data.email && !data.phone)) return;
  const ok = await patchHSContact(row.hubspot_contact_id, { email: data.email, phone: data.phone });
  if (!ok) await db.from("wishlist_contacts").update({ hubspot_error: "No se pudo actualizar email/teléfono en HubSpot" }).eq("id", row.id);
}
