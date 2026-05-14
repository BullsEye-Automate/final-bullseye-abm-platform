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
import {
  batchReadContacts,
  batchReadCompanies,
  type HubSpotContactSlim,
  type HubSpotCompanySlim
} from "./hubspotContacts";

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
  imported: number;          // contactos creados nuevos en Supabase
  imported_companies: number; // empresas creadas nuevas en Supabase
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
  options: { limit?: number; importUnmatched?: boolean } = {}
): Promise<LinkOrphansResult> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const importUnmatched = options.importUnmatched !== false; // default: true

  const result: LinkOrphansResult = {
    ok: true,
    scanned: 0,
    fetched_from_hubspot: 0,
    linked: 0,
    by_strategy: { wecad_id: 0, hubspot_id: 0, linkedin: 0, email: 0 },
    imported: 0,
    imported_companies: 0,
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

  // 4. Para cada orphan, resolvemos en cascada. Las que no matchean
  // las juntamos para importarlas después si importUnmatched=true.
  const unmatched: Array<{ orphan: Orphan; hsContact: HubSpotContactSlim }> = [];

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
      unmatched.push({ orphan: o, hsContact });
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

    if (!matched.row.hubspot_contact_id) {
      await db
        .from("contacts")
        .update({ hubspot_contact_id: hsContact.id })
        .eq("id", matched.row.id);
    }

    result.linked++;
    result.by_strategy[matched.strategy]++;
  }

  // 5. Auto-import: para las unmatched, traemos las companies asociadas
  // de HubSpot, las upsertea-mos en Supabase, creamos contactos en
  // Supabase y vinculamos las calls.
  if (!importUnmatched || unmatched.length === 0) {
    result.still_orphan += unmatched.length;
    return result;
  }

  const companyIds = Array.from(
    new Set(unmatched.map((u) => u.hsContact.associatedcompanyid).filter((v): v is string => !!v))
  );
  const companyMap = new Map<string, HubSpotCompanySlim>();
  if (companyIds.length > 0) {
    const compRes = await batchReadCompanies(companyIds);
    if (compRes.ok) {
      for (const c of compRes.data) companyMap.set(c.id, c);
    } else {
      result.errors.push({ stage: "hubspot_companies_read", message: compRes.error });
      // No tirar abajo el import, seguimos sin company info
    }
  }

  // Pre-resolver Supabase companies por hubspot_company_id para reusar.
  const supabaseCompanyByHsId = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: existing } = await db
      .from("companies")
      .select("id, hubspot_company_id")
      .in("hubspot_company_id", companyIds);
    for (const row of (existing ?? []) as Array<{ id: string; hubspot_company_id: string | null }>) {
      if (row.hubspot_company_id) supabaseCompanyByHsId.set(row.hubspot_company_id, row.id);
    }
  }

  for (const { orphan, hsContact } of unmatched) {
    try {
      let supabaseCompanyId: string | null = null;
      const hsCompanyId = hsContact.associatedcompanyid;

      if (hsCompanyId) {
        // ¿Ya existe en Supabase?
        const existing = supabaseCompanyByHsId.get(hsCompanyId);
        if (existing) {
          supabaseCompanyId = existing;
        } else {
          const hsCompany = companyMap.get(hsCompanyId);
          if (hsCompany) {
            const { data: inserted, error: cErr } = await db
              .from("companies")
              .insert({
                company_name: hsCompany.name ?? "(sin nombre)",
                company_website: hsCompany.domain ? `https://${hsCompany.domain}` : null,
                company_linkedin_url: hsCompany.linkedin_company_page,
                company_city: hsCompany.city,
                company_country: hsCompany.country,
                company_size: hsCompany.numberofemployees,
                status: "approved", // viene de HubSpot, asumimos válida
                hubspot_company_id: hsCompany.id,
                research_summary: "Importada desde HubSpot vía vincular llamadas huérfanas."
              })
              .select("id")
              .single();
            if (cErr) {
              result.errors.push({ stage: "import_company", message: cErr.message });
            } else if (inserted) {
              supabaseCompanyId = (inserted as { id: string }).id;
              supabaseCompanyByHsId.set(hsCompanyId, supabaseCompanyId);
              result.imported_companies++;
            }
          }
        }
      }

      // Si no logramos company y la company es requerida (NOT NULL en
      // schema), creamos una placeholder por contacto. Hay que ver el
      // schema: contacts.company_id es NOT NULL en contacts_migration.sql.
      // Workaround: si no hay company, creamos una placeholder con
      // company_name = "(sin empresa en HubSpot)" para mantener el FK.
      if (!supabaseCompanyId) {
        const placeholderName = "(sin empresa en HubSpot)";
        const { data: placeholderCo, error: pcErr } = await db
          .from("companies")
          .insert({
            company_name: placeholderName,
            status: "approved",
            research_summary: "Placeholder creado al importar contacto huérfano sin company asociada en HubSpot."
          })
          .select("id")
          .single();
        if (pcErr) {
          result.errors.push({ stage: "import_company_placeholder", message: pcErr.message });
          result.still_orphan++;
          continue;
        }
        supabaseCompanyId = (placeholderCo as { id: string }).id;
        result.imported_companies++;
      }

      // Crear contact
      const linkedinUrl = hsContact.hs_linkedinid
        ? hsContact.hs_linkedinid.startsWith("http")
          ? hsContact.hs_linkedinid
          : `https://${hsContact.hs_linkedinid.replace(/^\/+/, "")}`
        : null;

      const { data: inserted, error: contactErr } = await db
        .from("contacts")
        .insert({
          company_id: supabaseCompanyId,
          first_name: hsContact.firstname,
          last_name: hsContact.lastname,
          job_title: hsContact.jobtitle,
          linkedin_url: linkedinUrl,
          email: hsContact.email,
          phone: hsContact.phone,
          hubspot_contact_id: hsContact.id,
          status: "contacted", // ya fue contactado (tiene call)
          prefilter_result: null,
          prefilter_reason: "Importado desde HubSpot vía vincular llamadas huérfanas."
        })
        .select("id")
        .single();
      if (contactErr) {
        result.errors.push({ stage: "import_contact", message: contactErr.message });
        result.still_orphan++;
        continue;
      }
      const newContactId = (inserted as { id: string }).id;
      result.imported++;

      // Vincular la call
      await db
        .from("calls")
        .update({ contact_id: newContactId, company_id: supabaseCompanyId })
        .eq("id", orphan.id);
    } catch (err) {
      result.errors.push({
        stage: "import_loop",
        message: err instanceof Error ? err.message : "Unknown"
      });
      result.still_orphan++;
    }
  }

  return result;
}
