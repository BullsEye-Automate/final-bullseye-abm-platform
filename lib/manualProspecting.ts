import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveWishlistContact, FEW_CONTACTS } from "@/lib/wishlistContacts";
import { ACTIVE_STATUSES } from "@/lib/prospectingDashboard";

// Búsqueda manual (prospección v3): empresas aprobadas donde la búsqueda
// automática encontró menos de FEW_CONTACTS contactos fit
// (client_wishlist.contacts_status = few_contacts). El prospector las trabaja
// en LinkedIn / Sales Navigator y suma los contactos a mano: quedan en
// wishlist_contacts con origin = manual y se aprueban de inmediato (mismo
// camino que un contacto automático aprobado: Lemlist del cliente + HubSpot
// de BullsEye + enriquecimiento de email y teléfono).

export const MANUAL_STATUSES = ["pending", "in_progress", "done", "no_contacts"] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export type ManualContact = {
  id: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  status: string;
  origin: string;
  email: string | null;
  phone: string | null;
  enrich_status: string;
  lemlist_error: string | null;
  hubspot_error: string | null;
};

export type ManualCompany = {
  id: string;
  client_id: string;
  client_name: string;
  company_name: string;
  domain: string | null;
  linkedin_url: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  facts: { label: string; value: string }[];
  contacts_found: number;
  contacts_searched_at: string | null;
  manual_status: ManualStatus;
  manual_by_email: string | null;
  manual_updated_at: string | null;
  contacts: ManualContact[];
};

const MIGRATION_HINT = "Falta aplicar la migración supabase/20261030_prospeccion_v3_migration.sql";

// Cola: abiertas (pending / in_progress) o, con view = closed, las cerradas
export async function listManualQueue(
  db: SupabaseClient,
  opts: { clientId: string | null; view: "open" | "closed" }
): Promise<{ items: ManualCompany[]; few_contacts: number }> {
  let q = db
    .from("client_wishlist")
    .select("id, client_id, company_name, domain, linkedin_url, fit_score, fit_reason, snapshot, contacts_found, contacts_searched_at, manual_status, manual_by_email, manual_updated_at, clients(name)")
    .in("status", ACTIVE_STATUSES)
    .eq("contacts_status", "few_contacts")
    .in("manual_status", opts.view === "open" ? ["pending", "in_progress"] : ["done", "no_contacts"])
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("contacts_searched_at", { ascending: true })
    .limit(500);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  const { data, error } = await q;
  if (error) throw new Error(/manual_/.test(error.message) ? MIGRATION_HINT : error.message);

  const ids = (data ?? []).map((r) => r.id);
  const contacts = new Map<string, ManualContact[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: cs, error: ce } = await db
      .from("wishlist_contacts")
      .select("id, wishlist_id, full_name, title, linkedin_url, status, origin, email, phone, enrich_status, lemlist_error, hubspot_error")
      .in("wishlist_id", ids.slice(i, i + 200))
      .neq("status", "rejected")
      .order("created_at", { ascending: true });
    if (ce) throw new Error(/origin/.test(ce.message) ? MIGRATION_HINT : ce.message);
    for (const c of cs ?? []) {
      const arr = contacts.get(c.wishlist_id) ?? [];
      arr.push(c as ManualContact);
      contacts.set(c.wishlist_id, arr);
    }
  }

  const items: ManualCompany[] = (data ?? []).map((r) => {
    const client = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as { name: string } | null;
    const snap = (r.snapshot ?? {}) as { facts?: { label: string; value: string }[] };
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: client?.name ?? "—",
      company_name: r.company_name,
      domain: r.domain,
      linkedin_url: r.linkedin_url,
      fit_score: r.fit_score,
      fit_reason: r.fit_reason,
      facts: Array.isArray(snap.facts) ? snap.facts.slice(0, 6) : [],
      contacts_found: r.contacts_found ?? 0,
      contacts_searched_at: r.contacts_searched_at,
      manual_status: r.manual_status as ManualStatus,
      manual_by_email: r.manual_by_email,
      manual_updated_at: r.manual_updated_at,
      contacts: contacts.get(r.id) ?? [],
    };
  });
  return { items, few_contacts: FEW_CONTACTS };
}

export async function setManualStatus(db: SupabaseClient, wishlistId: string, status: ManualStatus, email: string) {
  const { error } = await db
    .from("client_wishlist")
    .update({ manual_status: status, manual_by_email: email, manual_updated_at: new Date().toISOString() })
    .eq("id", wishlistId);
  if (error) throw new Error(/manual_/.test(error.message) ? MIGRATION_HINT : error.message);
}

const normLinkedin = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^(www\.|[a-z]{2}\.)/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

export type ManualContactInput = {
  full_name: string;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  phone?: string | null;
};

// Agrega un contacto encontrado a mano y lo aprueba (Lemlist + HubSpot + enriquecimiento)
export async function addManualContact(
  db: SupabaseClient,
  wishlistId: string,
  input: ManualContactInput,
  email: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const fullName = input.full_name.trim();
  if (!fullName) return { ok: false, error: "Falta el nombre" };
  const linkedin = input.linkedin_url?.trim() || null;
  if (linkedin && !/linkedin\.com\//i.test(linkedin)) return { ok: false, error: "El link debe ser de LinkedIn" };

  const { data: item } = await db.from("client_wishlist").select("id, client_id, manual_status").eq("id", wishlistId).maybeSingle();
  if (!item) return { ok: false, error: "Empresa no encontrada" };

  const [first, ...rest] = fullName.split(/\s+/);
  const { data: row, error } = await db
    .from("wishlist_contacts")
    .insert({
      client_id: item.client_id,
      wishlist_id: item.id,
      // Mismo LinkedIn = mismo contacto (unique wishlist_id + lead_id)
      lead_id: `manual:${linkedin ? normLinkedin(linkedin) : crypto.randomUUID()}`,
      full_name: fullName,
      first_name: first,
      last_name: rest.join(" ") || null,
      title: input.title?.trim() || null,
      linkedin_url: linkedin,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      fit_score: 100,
      fit_reason: "Agregado manualmente por el prospector",
      origin: "manual",
      added_by_email: email,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ese contacto ya está en esta empresa" };
    return { ok: false, error: /origin|added_by_email/.test(error.message) ? MIGRATION_HINT : error.message };
  }

  if (item.manual_status === "pending") await setManualStatus(db, item.id, "in_progress", email).catch(() => {});
  const approved = await approveWishlistContact(db, row.id, email);
  // El contacto queda guardado aunque falle Lemlist (sin key, etc.): el error se muestra en la fila
  return { ok: true, id: row.id, ...(approved.ok ? {} : { error: approved.error }) };
}
