import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addCompaniesToList,
  ensureWishlistCompanyList,
  getClientOwnLemlistKey,
  upsertLemlistCompany,
  WISHLIST_LIST_NAME,
} from "./lemlistDatabase";
import type { LemlistCompanyFields } from "./wishlist";

// Envío de una empresa de la wishlist a la cuenta Lemlist del cliente:
//   1. crea/actualiza la empresa en su CRM de Lemlist (POST /companies)
//   2. la agrega a la lista de empresas "Wishlist BullsEye" (se crea si no existe)
// Resultado en client_wishlist: lemlist_status ok | error | sin_key, y si
// salió bien el estado pasa a "in_lemlist". Nunca usa la key de BullsEye.

export async function pushWishlistItemToLemlist(
  db: SupabaseClient,
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: item } = await db
    .from("client_wishlist")
    .select("id, client_id, company_name, domain, linkedin_url, snapshot, status")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: "Empresa no encontrada" };

  const save = async (patch: Record<string, unknown>) =>
    db.from("client_wishlist").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", item.id);

  const apiKey = await getClientOwnLemlistKey(db, item.client_id);
  if (!apiKey) {
    await save({ lemlist_status: "sin_key", lemlist_error: "El cliente no tiene API key de Lemlist en Config. cliente" });
    return { ok: false, error: "sin_key" };
  }

  const snapshot = (item.snapshot ?? {}) as { lemlist_fields?: LemlistCompanyFields; [k: string]: unknown };
  const fields = snapshot.lemlist_fields ?? {};

  const company = await upsertLemlistCompany(apiKey, {
    name: item.company_name,
    domain: item.domain,
    linkedinUrl: item.linkedin_url,
    ...fields,
  });
  if (!company.ok) {
    await save({ lemlist_status: "error", lemlist_error: `Crear empresa (${company.status}): ${company.error}`.slice(0, 500) });
    return { ok: false, error: company.error };
  }

  const list = await ensureWishlistCompanyList(apiKey);
  if (!list.ok) {
    await save({ lemlist_status: "error", lemlist_error: `Lista "${WISHLIST_LIST_NAME}" (${list.status}): ${list.error}`.slice(0, 500) });
    return { ok: false, error: list.error };
  }

  const added = await addCompaniesToList(apiKey, list.data.listId, [company.data.companyId]);
  if (!added.ok) {
    await save({ lemlist_status: "error", lemlist_error: `Agregar a lista (${added.status}): ${added.error}`.slice(0, 500) });
    return { ok: false, error: added.error };
  }

  await save({
    lemlist_status: "ok",
    lemlist_error: null,
    // Solo avanza el estado si nadie lo movió todavía
    ...(item.status === "new" ? { status: "in_lemlist" } : {}),
    snapshot: { ...snapshot, lemlist_company_id: company.data.companyId, lemlist_list_id: list.data.listId },
  });
  return { ok: true };
}
