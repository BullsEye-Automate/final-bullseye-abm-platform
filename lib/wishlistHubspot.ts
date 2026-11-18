import type { SupabaseClient } from "@supabase/supabase-js";
import {
  associateContactCompany,
  patchHSContact,
  searchHSCompany,
  searchHSCompanyByDomain,
  searchHSContactByLinkedinUrl,
  upsertHSCompany,
  upsertHSContact,
  hsHeaders,
} from "./hubspot";
import { loadClientSettings } from "./radarAbm/server/store";

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
    // Atribuye el contacto al cliente ("Cliente BullsEye"); si falla no frena la aprobación
    const tag = hsContactId && client?.name ? await tagContactClient(hsContactId, { id: c.client_id, name: client.name }).catch((e) => ({ ok: false, error: String(e) })) : { ok: true };
    await db.from("wishlist_contacts").update({ hubspot_contact_id: hsContactId, hubspot_error: tag.ok ? null : `Cliente BullsEye: ${"error" in tag ? tag.error : ""}`.slice(0, 500) }).eq("id", c.id);
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

// ── «Cliente BullsEye» del contacto (pedido de BullsEye, 18-nov-2026) ─────────
// Al aprobar, el contacto queda atribuido al cliente en "Cliente BullsEye"
// (cliente_bullseye), así lo ven las SDR y Pulso ABM. Si el contacto ya
// existía se AGREGA el cliente a los valores que tenga (nunca se quitan los de
// otros clientes). Si la propiedad es de selección única y ya tiene otro
// cliente, no se pisa y se avisa.
const CLIENT_PROP = "cliente_bullseye";
type PropDef = { fieldType?: string; options?: { value: string; label: string }[] };
let propCache: { at: number; def: PropDef | null } | null = null;

async function clientPropDef(): Promise<PropDef | null> {
  if (propCache && Date.now() - propCache.at < 10 * 60_000) return propCache.def;
  const res = await fetch(`https://api.hubapi.com/crm/v3/properties/contacts/${CLIENT_PROP}`, { headers: hsHeaders() });
  const def = res.ok ? ((await res.json()) as PropDef) : null;
  propCache = { at: Date.now(), def };
  return def;
}

const compact = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Misma regla que Pulso ABM: nombre sin espacios igual o prefijo ("Acid Labs" ↔ "AcidLab")
function matchClientOption(def: PropDef | null, value: string) {
  const opts = def?.options ?? [], c = compact(value);
  return opts.find((o) => compact(o.label) === c || compact(o.value) === c)
    ?? (c.length >= 4 ? opts.find((o) => { const l = compact(o.label); return l.length >= 4 && (l.startsWith(c) || c.startsWith(l)); }) : undefined);
}

export async function tagContactClient(
  hsContactId: string,
  client: { id: string; name: string }
): Promise<{ ok: boolean; changed?: boolean; error?: string }> {
  const settings = await loadClientSettings(client.id).catch(() => null);
  const want = ((settings?.hubspot_client_value ?? "").trim() || client.name).trim();
  const def = await clientPropDef();
  if (!def) return { ok: false, error: `No se encontró la propiedad "Cliente BullsEye" en HubSpot` };
  const opt = matchClientOption(def, want);
  if (!opt) return { ok: false, error: `"Cliente BullsEye" no tiene la opción "${want}"` };

  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${hsContactId}?properties=${CLIENT_PROP}`, { headers: hsHeaders() });
  if (!res.ok) return { ok: false, error: `HubSpot GET contact ${hsContactId} → ${res.status}` };
  const current = String((await res.json()).properties?.[CLIENT_PROP] ?? "");
  const values = current.split(";").map((v) => v.trim()).filter(Boolean);
  if (values.includes(opt.value)) return { ok: true, changed: false };

  let next: string;
  if (def.fieldType === "checkbox") next = [...values, opt.value].join(";");
  else if (!values.length) next = opt.value;
  else return { ok: false, error: `"Cliente BullsEye" ya es "${current}" y es de selección única: no se pisó` };

  const ok = await patchHSContact(hsContactId, { [CLIENT_PROP]: next });
  return ok ? { ok: true, changed: true } : { ok: false, error: `No se pudo marcar "Cliente BullsEye" = ${opt.label}` };
}

// Contactos ya aprobados de un cliente: les agrega su «Cliente BullsEye»
export async function tagApprovedContacts(db: SupabaseClient, clientId: string) {
  const [{ data: client }, { data: rows }] = await Promise.all([
    db.from("clients").select("id, name").eq("id", clientId).maybeSingle(),
    db.from("wishlist_contacts").select("id, hubspot_contact_id").eq("client_id", clientId).eq("status", "approved").not("hubspot_contact_id", "is", null),
  ]);
  if (!client) return { ok: false, error: "Cliente no encontrado" };
  const out = { total: rows?.length ?? 0, marcados: 0, ya_estaban: 0, errores: [] as string[] };
  for (const r of rows ?? []) {
    const t = await tagContactClient(r.hubspot_contact_id as string, client as { id: string; name: string });
    if (t.ok && t.changed) out.marcados++;
    else if (t.ok) out.ya_estaban++;
    else out.errores.push(`${r.hubspot_contact_id}: ${t.error}`);
  }
  return { ok: true, ...out };
}

// Diagnóstico de solo lectura: ¿existen en HubSpot los contactos aprobados del
// cliente? Distingue activos, fusionados (HubSpot devuelve otro id) y borrados
// (archivados). No escribe nada.
export async function checkApprovedContacts(db: SupabaseClient, clientId: string) {
  const { data: rows } = await db
    .from("wishlist_contacts")
    .select("id, lead_id, hubspot_contact_id, hubspot_error, updated_at")
    .eq("client_id", clientId).eq("status", "approved").not("hubspot_contact_id", "is", null);
  const ids = Array.from(new Set((rows ?? []).map((r) => String(r.hubspot_contact_id))));
  const acct = await fetch("https://api.hubapi.com/account-info/v3/details", { headers: hsHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const read = async (archived: boolean) => {
    const found = new Map<string, { id: string; created: string | null; archivedAt?: string | null; cliente: string | null }>();
    for (let i = 0; i < ids.length; i += 100) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/batch/read?archived=${archived}`, {
        method: "POST", headers: hsHeaders(),
        body: JSON.stringify({ properties: ["createdate", "hs_merged_object_ids", CLIENT_PROP], inputs: ids.slice(i, i + 100).map((id) => ({ id })) }),
      });
      if (!res.ok && res.status !== 207) continue;
      const j = await res.json();
      for (const o of j.results ?? []) {
        const merged = String(o.properties?.hs_merged_object_ids ?? "").split(";").filter(Boolean);
        const hit = { id: String(o.id), created: o.properties?.createdate ?? null, archivedAt: o.archivedAt ?? null, cliente: o.properties?.[CLIENT_PROP] ?? null };
        found.set(String(o.id), hit);
        for (const m of merged) if (ids.includes(m)) found.set(m, hit);
      }
    }
    return found;
  };
  const [active, archived] = await Promise.all([read(false), read(true)]);
  const detalle = ids.map((id) => {
    const a = active.get(id), b = archived.get(id);
    const estado = a ? (a.id === id ? "existe" : `fusionado en ${a.id}`) : b ? `borrado ${b.archivedAt ?? ""}`.trim() : "no encontrado";
    const row = (rows ?? []).find((r) => String(r.hubspot_contact_id) === id);
    return { hubspot_id: id, origen: String(row?.lead_id ?? "").startsWith("hs:") ? "ya existía en HubSpot" : "creado por el portal", estado, cliente_bullseye: a?.cliente ?? null };
  });
  return { cuenta: acct?.portalId ?? null, total: ids.length, detalle };
}
