import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";
import {
  pushContactToHubSpot,
  pushCompanyToHubSpot,
  type HubSpotContactInput,
  type HubSpotCompanyInput
} from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// POST /api/contacts/[id]/push-to-lemlist
//
// Empuja un contacto pendiente DIRECTO a Lemlist, salteando Clay. Dos casos
// de uso:
//   - Contactos scrapeados del sitio web de la empresa: ya tienen email,
//     no tienen LinkedIn URL — Clay no aporta nada.
//   - Contactos de Sales Navigator: tienen LinkedIn URL, normalmente sin
//     email — Lemlist enriquece el email al insertar el lead.
// Basta con que el contacto tenga email O LinkedIn URL. La app genera
// icebreaker + email con Claude y pushea. Después también sincroniza el
// contacto a HubSpot (y su empresa si hace falta), igual que el flujo de
// revisión manual.
//
// Tras un push exitoso marca fit_action='enrich' para que el contacto pase
// del bucket "Pendientes" a "En campaña".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  type ContactRow = {
    id: string;
    company_id: string | null;
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
    prefilter_result: string | null;
    clay_pushed_at: string | null;
    lemlist_pushed_at: string | null;
  };
  const { data: contactRaw, error: fetchErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, " +
        "email, phone, seniority, fit_score, fit_reason, linkedin_icebreaker, email_subject, " +
        "email_body, prefilter_result, clay_pushed_at, lemlist_pushed_at"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contactRaw) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  const contact = contactRaw as unknown as ContactRow;

  if (contact.prefilter_result !== "yes") {
    return NextResponse.json(
      { error: "Solo se pueden empujar a Lemlist contactos que pasaron el pre-filtro (YES)." },
      { status: 400 }
    );
  }
  if (!contact.email && !contact.linkedin_url) {
    return NextResponse.json(
      {
        error:
          "Este contacto no tiene email ni URL de LinkedIn. El push directo a Lemlist necesita al menos uno."
      },
      { status: 400 }
    );
  }
  if (contact.lemlist_pushed_at) {
    return NextResponse.json({ error: "El contacto ya está en Lemlist." }, { status: 409 });
  }
  // Antes acá había un guard que bloqueaba push si clay_pushed_at != null,
  // bajo el supuesto de que Clay iba a pushear el lead a Lemlist con su
  // run condition "Add Lead to Campaign". Desde el cambio de flujo (la app
  // es la única que pushea a Lemlist), ese guard ya no aplica — al
  // contrario, los contactos pre-aprobados por Clay AI (fit_action=enrich)
  // son los que el SDR aprueba desde el bucket "Por aprobar". Removido.

  // Snapshot de la empresa para el push a Lemlist + datos para HubSpot.
  type CompanyRow = {
    id: string;
    company_name: string | null;
    company_website: string | null;
    company_linkedin_url: string | null;
    company_city: string | null;
    company_country: string | null;
    company_size: number | null;
    company_type: string | null;
    cad_software: string | null;
    scanner_technology: string | null;
    fit_signals: string | null;
    fit_score: string | null;
    approved_at: string | null;
    clay_pushed_at: string | null;
    hubspot_company_id: string | null;
  };
  let company: CompanyRow | null = null;
  if (contact.company_id) {
    const { data } = await db
      .from("companies")
      .select(
        "id, company_name, company_website, company_linkedin_url, company_city, company_country, " +
          "company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, " +
          "approved_at, clay_pushed_at, hubspot_company_id"
      )
      .eq("id", contact.company_id)
      .maybeSingle();
    company = (data as unknown as CompanyRow) ?? null;
  }

  // 1) Push a Lemlist. force_regenerate=true: ignora mensajes viejos
  // (legacy de Clay con prompts pre /entrenar-modelo) y regenera con la
  // config activa. Coherente con el bulk-approve-enrich del bucket
  // "Por aprobar".
  const lemlistResult = await pushApprovedToLemlist(db, params.id, contact, company, {
    force_regenerate: true
  });

  // Tras un push exitoso, marcamos fit_action='enrich' para que el contacto
  // salga de "Pendientes" y aparezca en "En campaña".
  if (lemlistResult.ok) {
    await db.from("contacts").update({ fit_action: "enrich" }).eq("id", params.id);
  }

  // 2) Sincronizar a HubSpot (contacto + empresa) SOLO si el contacto entró
  // a la campaña de Lemlist. Regla del producto: a HubSpot solo van los
  // aprobados FIT o los que entran a campaña. Si Lemlist falló, el contacto
  // queda en Pendientes con lemlist_push_error y se puede reintentar con
  // "Directo a Lemlist" — recién ahí se crea en HubSpot.
  let hubspotResult: unknown = null;
  if (lemlistResult.ok) {
    try {
      let hubspotCompanyId: string | null = company?.hubspot_company_id ?? null;
      let companySnapshot: {
        company_type: string | null;
        cad_software: string | null;
        scanner_technology: string | null;
      } | null = null;
      if (company) {
        const cRes = await pushCompanyToHubSpot(db, company as unknown as HubSpotCompanyInput);
        if (cRes.ok) hubspotCompanyId = cRes.hubspot_id;
        companySnapshot = {
          company_type: company.company_type,
          cad_software: company.cad_software,
          scanner_technology: company.scanner_technology
        };
      }
      // Recargamos el contacto: pushApprovedToLemlist persistió los mensajes
      // generados, y queremos que HubSpot reciba los wecad_* fields al día.
      const { data: freshRaw } = await db
        .from("contacts")
        .select(
          "id, company_id, first_name, last_name, job_title, email, phone, linkedin_url, " +
            "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, " +
            "human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
            "phone_enrichment_status, phone_source, hubspot_contact_id"
        )
        .eq("id", params.id)
        .maybeSingle();
      if (freshRaw) {
        hubspotResult = await pushContactToHubSpot(
          db,
          freshRaw as unknown as HubSpotContactInput,
          hubspotCompanyId,
          companySnapshot
        );
      }
    } catch (err) {
      hubspotResult = {
        ok: false,
        error: err instanceof Error ? err.message : "HubSpot push failed"
      };
    }
  }

  const { data: refetched } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, " +
        "phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, " +
        "fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, " +
        "clay_push_error, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, " +
        "hubspot_synced_at, hubspot_sync_error, human_decision, human_decision_at, " +
        "human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .eq("id", params.id)
    .single();

  return NextResponse.json({
    contact: refetched,
    lemlist_push: lemlistResult,
    hubspot_push: hubspotResult
  });
}
