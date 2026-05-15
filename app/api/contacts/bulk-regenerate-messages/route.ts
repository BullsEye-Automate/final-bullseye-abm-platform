// Bulk regenerar mensajes (icebreaker + email subject + email body) de
// contactos cuya empresa fue re-verificada con datos honestos. Opcionalmente
// refresca el lead en Lemlist (DELETE + ADD con los mensajes nuevos) y
// re-pushea el contacto a HubSpot (idempotente, actualiza custom properties).
//
// Disparador: después del bulk re-verify de empresas (PR del régimen
// estricto de evidencia), los contactos asociados tienen mensajes basados
// en datos viejos inventados. Hay que regenerarlos antes de retomar la
// campaña de Lemlist.
//
// Procesamiento: paralelo en chunks de 3, cap de 15 contactos por request
// (Claude ~5-15s + Lemlist DELETE+ADD ~5-10s + HubSpot push ~3-5s ≈ 25s
// por contacto, 15 contactos / 3 concurrencia ≈ 125s, holgado para 300s
// de maxDuration). Si quedan más, el usuario re-corre el endpoint.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateMessages, type MessageInput } from "@/lib/messageGenerator";
import { addLeadToCampaign, deleteCampaignLead } from "@/lib/lemlist";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_LIMIT = 15;
const CONCURRENCY = 3;

type Body = {
  scope?: "all_with_messages" | "lemlist_only" | "hubspot_only" | "stale_only";
  refresh_lemlist?: boolean;
  refresh_hubspot?: boolean;
  batch_limit?: number;
};

type ContactRow = {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  seniority: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
  lemlist_pushed_at: string | null;
  hubspot_contact_id: string | null;
  updated_at: string | null;
};

type CompanyRow = {
  id: string;
  company_name: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  updated_at: string | null;
};

type PerContactResult = {
  id: string;
  contact_name: string;
  company_name: string | null;
  status: "regenerated" | "skipped_no_change" | "no_company" | "error";
  lemlist: "refreshed" | "not_in_lemlist" | "skipped" | "error" | null;
  lemlist_error?: string;
  hubspot: "refreshed" | "not_in_hubspot" | "skipped" | "error" | null;
  hubspot_error?: string;
  error?: string;
};

function changed(a: string | null, b: string | null): boolean {
  return (a ?? "").trim() !== (b ?? "").trim();
}

async function processOne(
  contact: ContactRow,
  company: CompanyRow | null,
  refreshLemlist: boolean,
  refreshHubspot: boolean,
  db: ReturnType<typeof supabaseAdmin>
): Promise<PerContactResult> {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();

  if (!company) {
    return {
      id: contact.id,
      contact_name: fullName || "(sin nombre)",
      company_name: null,
      status: "no_company",
      lemlist: null,
      hubspot: null
    };
  }

  let newIcebreaker: string;
  let newSubject: string;
  let newBody: string;
  try {
    const input: MessageInput = {
      first_name: contact.first_name,
      last_name: contact.last_name,
      job_title: contact.job_title,
      linkedin_headline: contact.linkedin_headline,
      seniority: contact.seniority,
      company_name: company.company_name,
      company_size: company.company_size,
      company_type: company.company_type,
      cad_software: company.cad_software,
      scanner_technology: company.scanner_technology,
      fit_signals: company.fit_signals
    };
    const generated = await generateMessages(input);
    newIcebreaker = generated.linkedin_icebreaker;
    newSubject = generated.email_subject;
    newBody = generated.email_body;
  } catch (err) {
    return {
      id: contact.id,
      contact_name: fullName || "(sin nombre)",
      company_name: company.company_name,
      status: "error",
      lemlist: null,
      hubspot: null,
      error: err instanceof Error ? err.message : "generateMessages failed"
    };
  }

  const hasChange =
    changed(contact.linkedin_icebreaker, newIcebreaker) ||
    changed(contact.email_subject, newSubject) ||
    changed(contact.email_body, newBody);

  if (!hasChange) {
    return {
      id: contact.id,
      contact_name: fullName || "(sin nombre)",
      company_name: company.company_name,
      status: "skipped_no_change",
      lemlist: refreshLemlist && contact.lemlist_pushed_at ? "skipped" : null,
      hubspot: refreshHubspot && contact.hubspot_contact_id ? "skipped" : null
    };
  }

  // Persistimos los mensajes nuevos en Supabase.
  await db
    .from("contacts")
    .update({
      linkedin_icebreaker: newIcebreaker,
      email_subject: newSubject,
      email_body: newBody,
      updated_at: new Date().toISOString()
    })
    .eq("id", contact.id);

  const result: PerContactResult = {
    id: contact.id,
    contact_name: fullName || "(sin nombre)",
    company_name: company.company_name,
    status: "regenerated",
    lemlist: null,
    hubspot: null
  };

  // Refresh Lemlist (DELETE + ADD con los mensajes nuevos). Lemlist no
  // expone UPDATE de lead, así que el patrón sano cuando los custom fields
  // cambian es borrar y volver a crear. Como el usuario pausó la campaña,
  // los leads no han progresado en la secuencia, así que esto es seguro.
  if (refreshLemlist) {
    if (!contact.lemlist_pushed_at) {
      result.lemlist = "not_in_lemlist";
    } else {
      const campaignId = process.env.LEMLIST_CAMPAIGN_ID;
      if (!campaignId) {
        result.lemlist = "error";
        result.lemlist_error = "LEMLIST_CAMPAIGN_ID no configurado";
      } else {
        // 1) DELETE — best-effort. Si falla, igual intentamos ADD (Lemlist
        // suele aceptar re-creación con el mismo email; si no, devolverá
        // duplicate y lo registramos en el error.
        const del = await deleteCampaignLead(campaignId, {
          id: null,
          email: contact.email
        });
        // 2) ADD.
        const add = await addLeadToCampaign(campaignId, {
          linkedinUrl: contact.linkedin_url,
          email: contact.email,
          firstName: contact.first_name,
          lastName: contact.last_name,
          companyName: company.company_name,
          jobTitle: contact.job_title,
          phone: contact.phone,
          icebreaker: newIcebreaker,
          emailSubject: newSubject,
          emailBody: newBody,
          wecad_fit_score: contact.fit_score,
          wecad_fit_reason: contact.fit_reason,
          wecad_fit_action: "enrich"
        });
        if (add.ok) {
          await db
            .from("contacts")
            .update({
              lemlist_pushed_at: new Date().toISOString(),
              lemlist_push_error: null
            })
            .eq("id", contact.id);
          result.lemlist = "refreshed";
        } else {
          const errMsg = `Lemlist ADD falló: ${add.error}${
            !del.ok ? ` · DELETE previo también falló (${del.error})` : ""
          }`;
          await db
            .from("contacts")
            .update({ lemlist_push_error: errMsg })
            .eq("id", contact.id);
          result.lemlist = "error";
          result.lemlist_error = errMsg;
        }
      }
    }
  }

  // Refresh HubSpot (push idempotente — busca por wecad_contact_id y
  // actualiza custom properties con los datos nuevos).
  if (refreshHubspot) {
    if (!contact.hubspot_contact_id) {
      result.hubspot = "not_in_hubspot";
    } else {
      try {
        const hs = await syncContactToHubSpot(db, contact.id);
        if (hs.ok) {
          result.hubspot = "refreshed";
        } else {
          result.hubspot = "error";
          result.hubspot_error = hs.error;
        }
      } catch (err) {
        result.hubspot = "error";
        result.hubspot_error = err instanceof Error ? err.message : "HubSpot sync failed";
      }
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const scope = body.scope ?? "all_with_messages";
  const refreshLemlist = body.refresh_lemlist !== false;
  const refreshHubspot = body.refresh_hubspot !== false;
  const limit = Math.min(Math.max(1, body.batch_limit ?? DEFAULT_LIMIT), 30);

  const db = supabaseAdmin();

  // Selección: contactos con mensajes generados (icebreaker no null).
  // scope=lemlist_only filtra a los que están en Lemlist.
  // scope=hubspot_only filtra a los que están en HubSpot.
  // scope=stale_only filtra a los que su empresa fue actualizada DESPUÉS
  //   del último update del contacto — el caso típico tras un re-verify
  //   de empresas.
  let query = db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, fit_score, fit_reason, linkedin_icebreaker, email_subject, email_body, lemlist_pushed_at, hubspot_contact_id, updated_at"
    )
    .not("linkedin_icebreaker", "is", null)
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3);

  if (scope === "lemlist_only") query = query.not("lemlist_pushed_at", "is", null);
  if (scope === "hubspot_only") query = query.not("hubspot_contact_id", "is", null);

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const contacts = (rows ?? []) as ContactRow[];
  if (contacts.length === 0) {
    return NextResponse.json({
      summary: {
        processed: 0,
        regenerated: 0,
        skipped_no_change: 0,
        lemlist_refreshed: 0,
        hubspot_refreshed: 0,
        errors: 0,
        remaining_in_queue: 0
      },
      results: []
    });
  }

  // Traemos las empresas asociadas en una sola query.
  const companyIds = Array.from(new Set(contacts.map((c) => c.company_id)));
  const { data: companyRows, error: cErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_size, company_type, cad_software, scanner_technology, fit_signals, updated_at"
    )
    .in("id", companyIds);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const companyById = new Map<string, CompanyRow>();
  for (const c of (companyRows ?? []) as CompanyRow[]) companyById.set(c.id, c);

  // Aplicamos filtro stale (empresa updated_at > contacto updated_at).
  let filtered = contacts;
  if (scope === "stale_only") {
    filtered = contacts.filter((ct) => {
      const co = companyById.get(ct.company_id);
      if (!co?.updated_at) return false;
      if (!ct.updated_at) return true;
      return new Date(co.updated_at).getTime() > new Date(ct.updated_at).getTime();
    });
  }

  const batch = filtered.slice(0, limit);

  const results: PerContactResult[] = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((ct) =>
        processOne(
          ct,
          companyById.get(ct.company_id) ?? null,
          refreshLemlist,
          refreshHubspot,
          db
        )
      )
    );
    results.push(...chunkResults);
  }

  const remaining = Math.max(0, filtered.length - batch.length);

  const summary = {
    processed: results.length,
    regenerated: results.filter((r) => r.status === "regenerated").length,
    skipped_no_change: results.filter((r) => r.status === "skipped_no_change").length,
    no_company: results.filter((r) => r.status === "no_company").length,
    lemlist_refreshed: results.filter((r) => r.lemlist === "refreshed").length,
    lemlist_errors: results.filter((r) => r.lemlist === "error").length,
    hubspot_refreshed: results.filter((r) => r.hubspot === "refreshed").length,
    hubspot_errors: results.filter((r) => r.hubspot === "error").length,
    errors: results.filter((r) => r.status === "error").length,
    remaining_in_queue: remaining
  };

  return NextResponse.json({ summary, results });
}
