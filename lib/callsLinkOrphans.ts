// Vincula calls huérfanas (con hubspot_contact_id pero sin contact_id en
// Supabase) a contactos/empresas nuestros, intentando varios criterios
// en orden de confianza. Sprint 5 fase 2 — alta tasa de "(sin contacto
// vinculado)" porque los SDRs llaman a leads que HubSpot tiene pero
// nuestra app no pusheó (vinieron de Lemlist sync u otra ruta).
//
// Orden de matching (de mayor a menor confianza):
//   1. wecad_contact_id (HubSpot property) → contacts.id en Supabase.
//      Best case: el contacto vino de nuestra app y conserva el UUID.
//   2. contacts.hubspot_contact_id en Supabase = el id del call.
//      (Esto ya lo probó el sync, pero re-corremos por si entró tarde.)
//   3. linkedin_url (case-insensitive, normalizado).
//   4. email (lower-case).
//
// Para cada call linkeada, también poblamos calls.company_id usando el
// company_id del contacto matcheado.

import type { SupabaseClient } from "@supabase/supabase-js";
import { batchReadContacts, type HubSpotContactSlim } from "./hubspotContacts";

type Orphan = {
  id: string;
  hubspot_contact_id: string;
};

type ContactRow = {
  id: string;
  company_id: string | null;
  hubspot_contact_id: string | null;
  linkedin_url: string | null;
  email: string | null;
};

export type LinkOrphansResult = {
  ok: boolean;
  scanned: number;
  fetched_from_hubspot: number;
  linked: number;
  by_strategy: {
    wecad_id: number;
    hubspot_id: number;
    linkedin: number;
    email: number;
  };
  still_orphan: number;
  errors: Array<{ stage: string; message: string }>;
};

function normalizeLinkedin(url: string | null): string | null {
  if (!url) return null;
  return url.trim().toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
}

function normalizeEmail(e: string | null): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t || null;
}

export async function linkOrphanCalls(
  db: SupabaseClient,
  options: { limit?: number } = {}
): Promise<LinkOrphansResult> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const result: LinkOrphansResult = {
    ok: true,
    scanned: 0,
    fetched_from_hubspot: 0,
    linked: 0,
    by_strategy: { wecad_id: 0, hubspot_id: 0, linkedin: 0, email: 0 },
    still_orphan: 0,
    errors: []
  };

  // 1. Calls huérfanas con hubspot_contact_id
  const { data: orphansRaw, error: orphErr } = await db
    .from("calls")
    .select("id, hubspot_contact_id")
    .is("contact_id", null)
    .not("hubspot_contact_id", "is", null)
    .limit(limit);
  if (orphErr) {
    result.ok = false;
    result.errors.push({ stage: "fetch_orphans", message: orphErr.message });
    return result;
  }
  const orphans = (orphansRaw ?? []) as unknown as Orphan[];
  result.scanned = orphans.length;
  if (orphans.length === 0) return result;

  // 2. Trae los contactos correspondientes de HubSpot (batch)
  const uniqueHsIds = Array.from(new Set(orphans.map((o) => o.hubspot_contact_id)));
  const hsRes = await batchReadContacts(uniqueHsIds);
  if (!hsRes.ok) {
    result.ok = false;
    result.errors.push({ stage: "hubspot_batch_read", message: hsRes.error });
    return result;
  }
  result.fetched_from_hubspot = hsRes.data.length;
  const hsById = new Map<string, HubSpotContactSlim>();
  for (const c of hsRes.data) hsById.set(c.id, c);

  // 3. Pre-carga contactos de Supabase que podrían matchear.
  //    En vez de buscar uno por uno, traemos en bulk los candidatos.
  const wecadIds = hsRes.data.map((c) => c.wecad_contact_id).filter((v): v is string => !!v);
  const hubspotIds = hsRes.data.map((c) => c.id);
  const linkedinKeys = hsRes.data
    .map((c) => normalizeLinkedin(c.hs_linkedinid))
    .filter((v): v is string => !!v);
  const emailKeys = hsRes.data
    .map((c) => normalizeEmail(c.email))
    .filter((v): v is string => !!v);

  const supabaseContacts: ContactRow[] = [];

  if (wecadIds.length > 0) {
    const { data } = await db
      .from("contacts")
      .select("id, company_id, hubspot_contact_id, linkedin_url, email")
      .in("id", wecadIds);
    supabaseContacts.push(...((data ?? []) as unknown as ContactRow[]));
  }
  if (hubspotIds.length > 0) {
    const { data } = await db
      .from("contacts")
      .select("id, company_id, hubspot_contact_id, linkedin_url, email")
      .in("hubspot_contact_id", hubspotIds);
    supabaseContacts.push(...((data ?? []) as unknown as ContactRow[]));
  }
  // Para linkedin y email no tenemos IN-on-lowered; traemos ambos lados
  // con OR aproximado vía dos queries baratas.
  if (linkedinKeys.length > 0) {
    // No tenemos índice case-insensitive; igual hacemos un fetch amplio
    // y filtramos en JS. Limitamos a 1000 para no traer toda la tabla.
    const { data } = await db
      .from("contacts")
      .select("id, company_id, hubspot_contact_id, linkedin_url, email")
      .not("linkedin_url", "is", null)
      .limit(1000);
    supabaseContacts.push(...((data ?? []) as unknown as ContactRow[]));
  }

  // Dedup por id (las queries pueden traer overlap).
  const byId = new Map<string, ContactRow>();
  for (const c of supabaseContacts) byId.set(c.id, c);
  const candidates = Array.from(byId.values());

  // Índices auxiliares para lookup rápido.
  const byHsId = new Map<string, ContactRow>();
  const byLinkedin = new Map<string, ContactRow>();
  const byEmail = new Map<string, ContactRow>();
  const byUuid = new Map<string, ContactRow>();
  for (const c of candidates) {
    byUuid.set(c.id, c);
    if (c.hubspot_contact_id) byHsId.set(c.hubspot_contact_id, c);
    const li = normalizeLinkedin(c.linkedin_url);
    if (li) byLinkedin.set(li, c);
    const em = normalizeEmail(c.email);
    if (em) byEmail.set(em, c);
  }

  // 4. Para cada orphan, resolvemos en cascada.
  for (const o of orphans) {
    const hsContact = hsById.get(o.hubspot_contact_id);
    if (!hsContact) {
      // HubSpot no devolvió esa fila (puede que la borraron en HS).
      result.still_orphan++;
      continue;
    }

    let matched: { row: ContactRow; strategy: "wecad_id" | "hubspot_id" | "linkedin" | "email" } | null =
      null;

    if (hsContact.wecad_contact_id && byUuid.has(hsContact.wecad_contact_id)) {
      matched = { row: byUuid.get(hsContact.wecad_contact_id)!, strategy: "wecad_id" };
    } else if (byHsId.has(hsContact.id)) {
      matched = { row: byHsId.get(hsContact.id)!, strategy: "hubspot_id" };
    } else {
      const li = normalizeLinkedin(hsContact.hs_linkedinid);
      if (li && byLinkedin.has(li)) {
        matched = { row: byLinkedin.get(li)!, strategy: "linkedin" };
      } else {
        const em = normalizeEmail(hsContact.email);
        if (em && byEmail.has(em)) {
          matched = { row: byEmail.get(em)!, strategy: "email" };
        }
      }
    }

    if (!matched) {
      result.still_orphan++;
      continue;
    }

    const { error: updErr } = await db
      .from("calls")
      .update({
        contact_id: matched.row.id,
        company_id: matched.row.company_id ?? null
      })
      .eq("id", o.id);
    if (updErr) {
      result.errors.push({ stage: "update_call", message: updErr.message });
      continue;
    }

    // Bonus: si la fila en contacts todavía no tenía hubspot_contact_id
    // pero el call dice que tiene uno, lo persistimos. Eso ayuda a que
    // futuros syncs/links salgan más rápido.
    if (!matched.row.hubspot_contact_id) {
      await db
        .from("contacts")
        .update({ hubspot_contact_id: hsContact.id })
        .eq("id", matched.row.id);
    }

    result.linked++;
    result.by_strategy[matched.strategy]++;
  }

  return result;
}
