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
import { getLemlistLeadByEmail } from "./lemlist";
import { searchByProperty, updateObject } from "./hubspot";
import { ensureContactProperties } from "./hubspotProperties";

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

export async function refreshLemlistPhones(
  db: SupabaseClient,
  opts: { limit?: number } = {}
): Promise<RefreshPhonesResult> {
  const campaignId = process.env.LEMLIST_CAMPAIGN_ID;
  if (!campaignId) {
    return { ...empty(), error: "LEMLIST_CAMPAIGN_ID is not configured" };
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);

  // Asegura que wecad_phone_* existan en HubSpot (idempotente, cached).
  await ensureContactProperties();

  // Contactos en campaña: fit_action='enrich' cubre tanto los que empujó la
  // app (push-to-lemlist / manual_review approve) como los auto-enrich de
  // Clay. Filtramos a los que tienen email y todavía no tienen un teléfono
  // de Lemlist registrado.
  const { data: rows, error } = await db
    .from("contacts")
    .select("id, email, phone, phone_source, hubspot_contact_id")
    .eq("fit_action", "enrich")
    .not("email", "is", null)
    .is("phone_lemlist", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { ...empty(), error: error.message };
  }
  const contacts = (rows ?? []) as unknown as ContactRow[];

  const res: RefreshPhonesResult = { ...empty(), ok: true };
  const pushErr = (m: string) => {
    res.errors += 1;
    if (res.sample_errors.length < 5) res.sample_errors.push(m);
  };

  for (const c of contacts) {
    if (!c.email) continue;
    res.checked += 1;

    let lead;
    try {
      lead = await getLemlistLeadByEmail(campaignId, c.email);
    } catch (err) {
      pushErr(`${c.email}: ${err instanceof Error ? err.message : "fetch error"}`);
      continue;
    }
    // Lead no está en la campaña, o la API falló: se reintenta el próximo run.
    if (!lead.ok) {
      res.lemlist_failed += 1;
      if (!res.debug) res.debug = {};
      if (!res.debug.first_failure) {
        res.debug.first_failure = { email: c.email, status: lead.status, error: lead.error, debug: lead.debug };
      }
      continue;
    }
    res.lemlist_ok += 1;
    // Lemlist todavía no enriqueció el teléfono. Guardamos el primer lead
    // crudo sin phone (con la respuesta HTTP cruda y las URLs probadas) para
    // poder ver el shape real de la respuesta de Lemlist.
    if (!lead.phone) {
      if (!res.debug) res.debug = {};
      if (!res.debug.first_lead_without_phone) {
        res.debug.first_lead_without_phone = {
          email: c.email,
          matched_url: lead.matched_url,
          status: lead.status,
          raw: lead.raw,
          parsed_lead: lead.lead,
          attempts: lead.attempts
        };
      }
      continue;
    }

    const phone = lead.phone;
    res.phones_found += 1;
    const hadPhone = !!(c.phone && c.phone.trim().length > 4);

    // 1) Supabase. phone_lemlist siempre. El principal solo si estaba vacío
    //    — no pisamos un teléfono de Lusha (Lusha es el fallback de mayor
    //    calidad y manda como principal cuando existe).
    const supFields: Record<string, unknown> = { phone_lemlist: phone };
    if (!hadPhone) {
      supFields.phone = phone;
      supFields.phone_source = "lemlist";
      supFields.phone_enrichment_status = "done_lemlist";
      supFields.phone_enriched_at = new Date().toISOString();
    }
    const { error: supErr } = await db.from("contacts").update(supFields).eq("id", c.id);
    if (supErr) pushErr(`${c.email} supabase: ${supErr.message}`);
    else res.supabase_updated += 1;

    // 2) HubSpot. Resolvemos el id: el guardado, o search por email (la sync
    //    nativa de Lemlist pudo haber creado el contacto por email).
    let hsId = c.hubspot_contact_id;
    if (!hsId) {
      const s = await searchByProperty("contacts", "email", c.email);
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
    else pushErr(`${c.email} hubspot: ${upd.error}`);
  }

  return res;
}
