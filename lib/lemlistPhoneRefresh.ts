// Refresh de teléfonos desde Lemlist hacia Supabase + HubSpot.
//
// Contexto: cuando la app empuja un contacto a Lemlist (addLeadToCampaign en
// lib/lemlist.ts) lo hace con findPhone=true, así que Lemlist dispara su
// waterfall de phone enrichment. Pero ese enrichment es ASÍNCRONO — el
// teléfono aparece minutos/horas después del push. La sync nativa de Lemlist
// a HubSpot a veces lo propaga y a veces no, y los contactos que la app creó
// en HubSpot quedaron sin teléfono.
//
// Esto cierra el loop: recorre los contactos en campaña que todavía no tienen
// un teléfono de Lemlist registrado, le pregunta a Lemlist el lead, y si ya
// hay teléfono lo persiste en Supabase (phone_lemlist + phone principal si
// estaba vacío) y lo PATCHea en HubSpot. Idempotente y re-ejecutable: una vez
// que un contacto tiene phone_lemlist deja de consultarse.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCampaignLeadsWithDetails, type LemlistCampaignLead } from "./lemlist";
import { searchByProperty, updateObject } from "./hubspot";
import { ensureContactProperties } from "./hubspotProperties";
import { getLemlistCampaignIds } from "./lemlistCampaigns";

export type RefreshPhonesResult = {
  ok: boolean;
  checked: number; // contactos consultados a Lemlist
  lemlist_ok: number; // fetches a Lemlist que devolvieron 2xx
  lemlist_failed: number; // fetches que fallaron en todos los patrones de URL
  phones_found: number; // Lemlist devolvió teléfono
  supabase_updated: number;
  hubspot_updated: number;
  not_in_hubspot: number; // teléfono hallado pero el contacto no está en HubSpot
  errors: number;
  sample_errors: string[];
  // Muestra para diagnóstico: el primer fetch que falló y el primer lead que
  // vino sin teléfono (para ver el shape real de la respuesta de Lemlist).
  debug?: {
    first_failure?: unknown;
    first_lead_without_phone?: unknown;
  };
  error?: string;
};

type ContactRow = {
  id: string;
  email: string | null;
  phone: string | null;
  phone_source: string | null;
  hubspot_contact_id: string | null;
};

function empty(): RefreshPhonesResult {
  return {
    ok: false,
    checked: 0,
    lemlist_ok: 0,
    lemlist_failed: 0,
    phones_found: 0,
    supabase_updated: 0,
    hubspot_updated: 0,
    not_in_hubspot: 0,
    errors: 0,
    sample_errors: []
  };
}

type ContactRowExt = ContactRow & { linkedin_url: string | null };

function normalizeLinkedin(url: string | null | undefined): string {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

export async function refreshLemlistPhones(
  db: SupabaseClient,
  opts: { limit?: number } = {}
): Promise<RefreshPhonesResult> {
  const campaignIds = getLemlistCampaignIds();
  if (campaignIds.length === 0) {
    return { ...empty(), error: "LEMLIST_CAMPAIGN_ID is not configured" };
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  // Asegura que wecad_phone_* existan en HubSpot (idempotente, cached).
  await ensureContactProperties();

  // Contactos en campaña: fit_action='enrich' cubre tanto los que empujó la
  // app (push-to-lemlist / manual_review approve) como los auto-enrich de
  // Clay. NO filtramos por email — los contactos de Sales Nav pushean solo
  // con linkedin_url y Lemlist los enriquece con email + phone después.
  const { data: rows, error } = await db
    .from("contacts")
    .select("id, email, linkedin_url, phone, phone_source, hubspot_contact_id")
    .eq("fit_action", "enrich")
    .is("phone_lemlist", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { ...empty(), error: error.message };
  }
  const contacts = (rows ?? []) as unknown as ContactRowExt[];

  const res: RefreshPhonesResult = { ...empty(), ok: true };
  const pushErr = (m: string) => {
    res.errors += 1;
    if (res.sample_errors.length < 5) res.sample_errors.push(m);
  };

  if (contacts.length === 0) return res;

  // Fetch a Lemlist para los leads de TODAS las campañas configuradas
  // (v1 vieja + v2 nueva). Mucho más eficiente que llamar lead por lead.
  type LemlistLead = LemlistCampaignLead;
  const allLeads: LemlistLead[] = [];
  let firstFailureDebug: unknown = null;
  for (const cid of campaignIds) {
    const got = await getCampaignLeadsWithDetails(cid);
    if (!got.ok) {
      if (!firstFailureDebug) {
        firstFailureDebug = { campaign_id: cid, error: got.error, debug: got.debug };
      }
      continue;
    }
    allLeads.push(...(got.leads as LemlistLead[]));
  }
  if (allLeads.length === 0 && firstFailureDebug) {
    res.lemlist_failed = contacts.length;
    res.debug = { first_failure: firstFailureDebug };
    return res;
  }
  res.lemlist_ok = allLeads.length;

  // Index por email y por linkedin_url normalizado para match cruzado.
  const byEmail = new Map<string, LemlistLead>();
  const byLinkedin = new Map<string, LemlistLead>();
  for (const lead of allLeads) {
    if (lead.email) byEmail.set(lead.email.toLowerCase().trim(), lead);
    const lk = normalizeLinkedin(lead.linkedin_url);
    if (lk) byLinkedin.set(lk, lead);
  }

  for (const c of contacts) {
    res.checked += 1;

    let lead: LemlistLead | undefined;
    if (c.email) lead = byEmail.get(c.email.toLowerCase().trim());
    if (!lead && c.linkedin_url) lead = byLinkedin.get(normalizeLinkedin(c.linkedin_url));

    if (!lead) {
      // Contacto no está en la campaña — Lemlist aún no lo enroló o la
      // extensión usó otra cuenta. No es un error blocking.
      continue;
    }
    if (!lead.phone) {
      if (!res.debug) res.debug = {};
      if (!res.debug.first_lead_without_phone) {
        res.debug.first_lead_without_phone = {
          contact_id: c.id,
          email: c.email,
          linkedin_url: c.linkedin_url,
          lead_email: lead.email,
          lead_linkedin: lead.linkedin_url
        };
      }
      continue;
    }

    const phone = lead.phone;
    res.phones_found += 1;
    const hadPhone = !!(c.phone && c.phone.trim().length > 4);
    const enrichedEmail = c.email ?? lead.email ?? null;

    // 1) Supabase. phone_lemlist siempre. El principal solo si estaba vacío
    //    — no pisamos un teléfono de Lusha. Si el contacto no tenía email
    //    pero Lemlist lo enriqueció, también persistimos email.
    const supFields: Record<string, unknown> = { phone_lemlist: phone };
    if (!hadPhone) {
      supFields.phone = phone;
      supFields.phone_source = "lemlist";
      supFields.phone_enrichment_status = "done_lemlist";
      supFields.phone_enriched_at = new Date().toISOString();
    }
    if (!c.email && lead.email) {
      supFields.email = lead.email;
    }
    const { error: supErr } = await db.from("contacts").update(supFields).eq("id", c.id);
    if (supErr) pushErr(`${c.id} supabase: ${supErr.message}`);
    else res.supabase_updated += 1;

    // 2) HubSpot. Resolvemos el id: el guardado, o search por email.
    let hsId = c.hubspot_contact_id;
    if (!hsId && enrichedEmail) {
      const s = await searchByProperty("contacts", "email", enrichedEmail);
      if (s.ok && s.data && s.data.total > 0) {
        hsId = s.data.results[0].id;
        await db.from("contacts").update({ hubspot_contact_id: hsId }).eq("id", c.id);
      }
    }
    if (!hsId) {
      res.not_in_hubspot += 1;
      continue;
    }

    const hsProps: Record<string, string> = { wecad_phone_lemlist: phone };
    if (!hadPhone) {
      hsProps.phone = phone;
      hsProps.wecad_phone_source = "lemlist";
      hsProps.wecad_phone_enrichment_status = "done_lemlist";
    }
    const upd = await updateObject("contacts", hsId, hsProps);
    if (upd.ok) res.hubspot_updated += 1;
    else pushErr(`${c.id} hubspot: ${upd.error}`);
  }

  return res;
}
