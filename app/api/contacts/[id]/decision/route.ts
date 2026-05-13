import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";
import {
  pushCompanyToHubSpot,
  pushContactToHubSpot,
  type HubSpotCompanyInput,
  type HubSpotContactInput
} from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Veredicto humano sobre un contacto en la cola de revisión manual (score 5-7).
// approved → marca fit_action='enrich' y empuja el contacto a Lemlist directamente
//   (Sprint 3 fase 2: bypass Clay porque Clay API REST no expone CRUD de rows;
//   ver CLAUDE.md sección "Investigación Clay API"). Si el contacto no tiene
//   icebreaker/subject/body, los generamos con Claude antes de pushear.
// rejected → marca status='discarded'. Razón obligatoria.
// En ambos casos persiste un registro en contact_feedback con los valores que
// devolvió Claude (score + action) vs. la decisión humana.

type Body = {
  decision: "approved" | "rejected";
  reason?: string;
  reviewer?: string;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || (body.decision !== "approved" && body.decision !== "rejected")) {
    return NextResponse.json(
      { error: "decision must be approved or rejected" },
      { status: 400 }
    );
  }
  if (body.decision === "rejected" && !body.reason?.trim()) {
    return NextResponse.json(
      { error: "reason is required when rejecting" },
      { status: 400 }
    );
  }

  const reviewer = body.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const db = supabaseAdmin();

  const { data: contact, error: fetchErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, human_decision, prefilter_result, clay_pushed_at, lemlist_pushed_at"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  let company: {
    company_name: string | null;
    company_size: number | null;
    company_type: string | null;
    cad_software: string | null;
    scanner_technology: string | null;
    fit_signals: string | null;
  } | null = null;
  if (contact.company_id) {
    const { data } = await db
      .from("companies")
      .select(
        "company_name, company_size, company_type, cad_software, scanner_technology, fit_signals"
      )
      .eq("id", contact.company_id)
      .maybeSingle();
    company = data ?? null;
  }

  const now = new Date().toISOString();
  // Distinguimos "approve desde manual_review" (fit_action='enrich' → En campaña)
  // vs "recover desde Descartados" (fit_action=null + status=pending → Pendientes).
  // Un contacto se considera recovery si estaba descartado por prefilter NO o
  // status discarded — no por fit_action='manual_review'.
  const isRecovery =
    body.decision === "approved" &&
    (contact.status === "discarded" || contact.prefilter_result === "no");

  const update: Record<string, any> =
    body.decision === "approved"
      ? {
          human_decision: "approved",
          human_decision_at: now,
          human_decision_reason: body.reason?.trim() || null,
          human_decision_by: reviewer,
          ...(isRecovery
            ? {
                // Recuperación desde Descartados: vuelve a Pendientes como
                // contacto fresco, listo para empujarse a Clay. Limpiamos
                // clay_pushed_at para que el botón Prospectar reaparezca.
                fit_action: null,
                status: "pending",
                clay_pushed_at: null,
                clay_push_error: null,
                ...(contact.prefilter_result === "no" ? { prefilter_result: "yes" } : {})
              }
            : {
                // Aprobación desde Revisión manual: el contacto YA está en Clay.
                // Solo marcamos fit_action='enrich'. El push a Lemlist se hace
                // después de aplicar este update.
                fit_action: "enrich"
              })
        }
      : {
          human_decision: "rejected",
          human_decision_at: now,
          human_decision_reason: body.reason!.trim(),
          human_decision_by: reviewer,
          status: "discarded"
        };

  const { data: updated, error: updateErr } = await db
    .from("contacts")
    .update(update)
    .eq("id", params.id)
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, clay_push_error, lemlist_pushed_at, lemlist_push_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { error: fbErr } = await db.from("contact_feedback").insert({
    contact_id: params.id,
    company_name: company?.company_name ?? null,
    job_title: contact.job_title,
    linkedin_headline: contact.linkedin_headline,
    company_size: company?.company_size ?? null,
    claude_score: contact.fit_score,
    claude_action: contact.fit_action,
    human_action: body.decision,
    human_reason: body.reason?.trim() || null,
    reviewer
  });
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  // Push a Lemlist solo cuando aprobamos desde Revisión manual (no recovery)
  // y el contacto no fue empujado todavía. Recovery vuelve a Pendientes y
  // sigue el flujo normal Clay → Lemlist.
  let lemlist_push:
    | { ok: true; lead_id?: string; messages_generated: boolean; model_used?: string }
    | { ok: false; error: string; status?: number; debug?: unknown }
    | null = null;
  let hubspot_push:
    | { ok: true; hubspot_id: string; created: boolean }
    | { ok: false; error: string; status?: number; debug?: unknown }
    | null = null;

  const shouldPushLemlist =
    body.decision === "approved" && !isRecovery && !contact.lemlist_pushed_at;

  if (shouldPushLemlist) {
    // Orden: Lemlist primero (genera mensajes + crea el lead, fuente de
    // verdad del icebreaker / subject / body). Después HubSpot, con todos
    // los datos actualizados — incluye lemlist_pushed_at en wecad_*.
    // Lemlist enriquece phone proactivamente (findPhone=true) y syncroniza
    // a HubSpot vía su integración nativa. Si no encuentra phone, el SDR
    // puede ir a /telefonos y disparar Lusha manualmente.
    lemlist_push = await pushApprovedToLemlist(db, params.id, contact, company);
  }

  // Push a HubSpot en cualquier approval desde manual_review (success O
  // failure de Lemlist no bloquea — HubSpot recibe el estado actual,
  // incluyendo lemlist_push_error si lo hubo). En recovery también
  // pusheamos: el contacto vuelve a Pendientes pero queremos tenerlo en
  // HubSpot con su historia.
  if (body.decision === "approved") {
    // Re-fetch contacto + company para pushear con datos frescos.
    const { data: fresh } = await db
      .from("contacts")
      .select(
        "id, company_id, first_name, last_name, job_title, email, phone, linkedin_url, fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, phone_enrichment_status, phone_source, hubspot_contact_id"
      )
      .eq("id", params.id)
      .single();
    if (fresh) {
      // Push company a HubSpot primero (necesitamos su id para asociar).
      let hubspotCompanyId: string | null = null;
      let companySnapshot: {
        company_type: string | null;
        cad_software: string | null;
        scanner_technology: string | null;
      } | null = null;
      if (fresh.company_id) {
        const { data: companyRow } = await db
          .from("companies")
          .select(
            "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id"
          )
          .eq("id", fresh.company_id)
          .maybeSingle();
        if (companyRow) {
          const cRes = await pushCompanyToHubSpot(db, companyRow as HubSpotCompanyInput);
          if (cRes.ok) hubspotCompanyId = cRes.hubspot_id;
          companySnapshot = {
            company_type: companyRow.company_type,
            cad_software: companyRow.cad_software,
            scanner_technology: companyRow.scanner_technology
          };
        }
      }
      hubspot_push = await pushContactToHubSpot(
        db,
        fresh as HubSpotContactInput,
        hubspotCompanyId,
        companySnapshot
      );
    }
  }

  // Re-fetch final del contacto con todo el estado (lemlist + hubspot).
  const { data: refetched } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, clay_push_error, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, hubspot_synced_at, hubspot_sync_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .eq("id", params.id)
    .single();

  return NextResponse.json({
    contact: refetched ?? updated,
    lemlist_push,
    hubspot_push
  });
}
