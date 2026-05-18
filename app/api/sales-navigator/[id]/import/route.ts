import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, type RawContact } from "@/lib/contactsIntake";
import { getCampaignLeadsWithDetails, deleteCampaignLead } from "@/lib/lemlist";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";
import {
  pushCompanyToHubSpot,
  pushContactToHubSpot,
  type HubSpotCompanyInput,
  type HubSpotContactInput
} from "@/lib/hubspotPush";
import { detectNameEmailMismatch } from "@/lib/contactValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pre-filtro de Claude por cada contacto + DELETEs a Lemlist al final.
export const maxDuration = 300;

// POST /api/sales-navigator/[id]/import
//   body { lemlist_lead_ids: string[] }
//
// Importa los leads SELECCIONADOS de la Campaña puente a esta empresa.
// La UI le pasa los lemlist `_id`s que el usuario marcó en el preview con
// checkboxes. Luego de un intake exitoso, borra esos mismos leads de la
// Campaña puente en Lemlist (DELETE) para que la puente quede limpia
// entre empresas — los unselected quedan en la puente para procesarlos
// con otra empresa después.
//
// El dedup por linkedin_url/email a nivel empresa (intakeContactsForCompany)
// hace que re-importar el mismo lead a la misma empresa no duplique.
//
// Los DELETEs son best-effort: si fallan, el contacto ya quedó en Supabase
// y la respuesta incluye delete_errors para que la UI los muestre.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const stagingId = process.env.LEMLIST_STAGING_CAMPAIGN_ID;
  if (!stagingId) {
    return NextResponse.json(
      {
        error:
          "Falta LEMLIST_STAGING_CAMPAIGN_ID en Vercel — es el ID de la campaña puente de Lemlist."
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawIds = (body as { lemlist_lead_ids?: unknown }).lemlist_lead_ids;
  // Si auto_push_lemlist=true, los contactos importados saltean Clay's
  // Lead Scoring y van DIRECTO a Lemlist (con scoring/messages generados
  // por la app). Pensado para Sales Nav imports donde el SDR ya curó
  // manualmente los contactos en LinkedIn — no tiene sentido hacerlos
  // pasar por Clay AI otra vez.
  const autoPushLemlist =
    (body as { auto_push_lemlist?: boolean }).auto_push_lemlist === true;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Falta lemlist_lead_ids — ningún lead seleccionado para importar."
      },
      { status: 400 }
    );
  }
  const wantedIds = new Set(
    rawIds.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    )
  );
  if (wantedIds.size === 0) {
    return NextResponse.json(
      { error: "lemlist_lead_ids vacío después de validar." },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_name")
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  // Re-fetch fresco — la lista del preview puede haber cambiado.
  // getCampaignLeadsWithDetails: lista los leads + hace GET /api/leads/{id}
  // por cada uno para traer email/linkedinUrl/firstName/lastName/jobTitle/
  // companyName. El GET de lista directo solo devuelve {_id, state,
  // contactId} (probado vía /api/lemlist/diagnose-campaign) — sin esto, la
  // UI muestra "(sin nombre)" y el match por nombre de empresa es imposible.
  const leadsRes = await getCampaignLeadsWithDetails(stagingId);
  if (!leadsRes.ok) {
    return NextResponse.json(
      {
        error: `No se pudieron leer los leads de la campaña puente: ${leadsRes.error}`,
        debug: leadsRes.debug
      },
      { status: 502 }
    );
  }

  const selected = leadsRes.leads.filter((l) => l.id && wantedIds.has(l.id));
  if (selected.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { inserted: 0, yes: 0, no: 0, skipped: 0 },
      contacts: [],
      staged_total: leadsRes.leads.length,
      selected_count: 0,
      deleted: 0,
      delete_errors: [],
      matched_url: leadsRes.matched_url
    });
  }

  const contacts: RawContact[] = selected.map((l) => ({
    first_name: l.first_name,
    last_name: l.last_name,
    job_title: l.job_title,
    linkedin_headline: null,
    linkedin_url: l.linkedin_url,
    email: l.email
  }));

  // Si auto_push_lemlist, le decimos al intake que NO pushee a Clay
  // (esos contactos ya están manualmente curados por el SDR — Clay sería
  // un paso innecesario que solo agrega latencia y créditos).
  const result = await intakeContactsForCompany(db, params.id, contacts, "sales_navigator", {
    auto_push_clay: !autoPushLemlist
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Auto-limpiar la Campaña puente: DELETE de cada lead seleccionado.
  // Best-effort — errores se devuelven en delete_errors pero no rompen
  // la respuesta (el contacto ya quedó en Supabase).
  let deleted = 0;
  const delete_errors: { lead: string; error: string }[] = [];
  for (const l of selected) {
    if (!l.id && !l.email && !l.contact_id) continue;
    const del = await deleteCampaignLead(stagingId, {
      id: l.id,
      email: l.email,
      // contactId es el resource principal en Lemlist nuevo. Sin esto,
      // DELETE /campaigns/{id}/leads/{lea_xxx} y /leads/{lea_xxx} fallan
      // y los leads quedan acumulándose en la Campaña puente.
      contact_id: l.contact_id
    });
    if (del.ok) {
      deleted += 1;
    } else {
      const who =
        [l.first_name, l.last_name].filter(Boolean).join(" ") ||
        l.email ||
        l.id ||
        "(sin id)";
      delete_errors.push({ lead: who, error: del.error });
    }
  }

  // Contactos YES de esta empresa listos para Lemlist (recién importados o
  // leftover de un import previo sin pushear todavía).
  const { data: fresh } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
        "linkedin_url, email, phone, seniority, prefilter_result, status, " +
        "fit_action, fit_score, fit_reason, linkedin_icebreaker, email_subject, " +
        "email_body, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, " +
        "clay_pushed_at, created_at"
    )
    .eq("company_id", params.id)
    .eq("prefilter_result", "yes")
    .is("lemlist_pushed_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  // ── Auto-push a Lemlist (Sales Nav directo, skipea Clay) ──
  // Si auto_push_lemlist=true, para cada contacto YES recién importado:
  //   1. fit_score calculado por contactScoring si está null (ya integrado
  //      en pushApprovedToLemlist desde Sprint 10).
  //   2. fit_action='enrich' marcado (los contactos de Sales Nav ya están
  //      curados — no necesitan revisión de Clay).
  //   3. Push a Lemlist con messageGenerator (config /entrenar-modelo).
  //   4. Sync a HubSpot (empresa + contacto).
  const auto_push_results: Array<{
    id: string;
    contact_name: string;
    lemlist: "pushed" | "error" | "skipped";
    lemlist_error?: string;
    hubspot: "synced" | "error" | "skipped";
    hubspot_error?: string;
    name_email_mismatch?: boolean;
    name_email_mismatch_reason?: string;
  }> = [];

  if (autoPushLemlist && fresh && fresh.length > 0) {
    // Necesitamos la empresa completa para el push.
    const { data: companyFull } = await db
      .from("companies")
      .select(
        "id, company_name, company_website, company_linkedin_url, company_city, " +
          "company_country, company_size, company_type, cad_software, scanner_technology, " +
          "fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id"
      )
      .eq("id", params.id)
      .maybeSingle();

    const CHUNK = 3;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(
        chunk.map(async (c: any) => {
          const fullName =
            [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)";

          // Guard contra bug de enrichment de Lemlist: si el email no
          // matchea el nombre, NO pusheamos (los mensajes IA usarían el
          // nombre equivocado). El SDR corrige en Lemlist y reintenta.
          const mismatch = detectNameEmailMismatch(c.first_name, c.last_name, c.email);
          if (mismatch.mismatch) {
            return {
              id: c.id,
              contact_name: fullName,
              lemlist: "skipped" as const,
              hubspot: "skipped" as const,
              name_email_mismatch: true,
              name_email_mismatch_reason: mismatch.reason
            };
          }

          // Marcar fit_action='enrich' (Sales Nav contacts ya curados).
          await db.from("contacts").update({ fit_action: "enrich" }).eq("id", c.id);

          // Push a Lemlist (genera mensajes con config + scoring fallback).
          const lemlistRes = await pushApprovedToLemlist(
            db,
            c.id,
            {
              first_name: c.first_name,
              last_name: c.last_name,
              job_title: c.job_title,
              linkedin_headline: c.linkedin_headline,
              linkedin_url: c.linkedin_url,
              email: c.email,
              phone: c.phone,
              seniority: c.seniority,
              fit_score: c.fit_score,
              fit_reason: c.fit_reason,
              linkedin_icebreaker: c.linkedin_icebreaker,
              email_subject: c.email_subject,
              email_body: c.email_body
            },
            companyFull
              ? {
                  company_name: (companyFull as any).company_name,
                  company_size: (companyFull as any).company_size,
                  company_type: (companyFull as any).company_type,
                  cad_software: (companyFull as any).cad_software,
                  scanner_technology: (companyFull as any).scanner_technology,
                  fit_signals: (companyFull as any).fit_signals
                }
              : null,
            { force_regenerate: true }
          );
          const lemlist = lemlistRes.ok ? ("pushed" as const) : ("error" as const);
          const lemlist_error = !lemlistRes.ok ? lemlistRes.error : undefined;

          // Sync a HubSpot (empresa primero, luego contacto).
          let hubspot: "synced" | "error" | "skipped" = "skipped";
          let hubspot_error: string | undefined;
          if (companyFull) {
            try {
              const cRes = await pushCompanyToHubSpot(
                db,
                companyFull as unknown as HubSpotCompanyInput
              );
              const hsCompanyId = cRes.ok ? cRes.hubspot_id : null;
              // Recargamos el contacto para tener los mensajes recién persistidos.
              const { data: cFresh } = await db
                .from("contacts")
                .select(
                  "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
                    "linkedin_url, email, phone, seniority, fit_score, fit_reason, fit_action, " +
                    "linkedin_icebreaker, email_subject, email_body, human_decision, " +
                    "human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
                    "phone_enrichment_status, phone_source, hubspot_contact_id"
                )
                .eq("id", c.id)
                .maybeSingle();
              const hsRes = await pushContactToHubSpot(
                db,
                (cFresh ?? c) as unknown as HubSpotContactInput,
                hsCompanyId,
                {
                  company_type: (companyFull as any).company_type ?? null,
                  cad_software: (companyFull as any).cad_software ?? null,
                  scanner_technology: (companyFull as any).scanner_technology ?? null
                }
              );
              if (hsRes.ok) hubspot = "synced";
              else {
                hubspot = "error";
                hubspot_error = hsRes.error;
              }
            } catch (err) {
              hubspot = "error";
              hubspot_error = err instanceof Error ? err.message : "HubSpot sync failed";
            }
          }

          return { id: c.id, contact_name: fullName, lemlist, lemlist_error, hubspot, hubspot_error };
        })
      );
      auto_push_results.push(...chunkResults);
    }
  }

  // Si hubo auto-push, re-fetch para que la UI vea lemlist_pushed_at actualizado.
  let finalContacts = fresh ?? [];
  if (autoPushLemlist && auto_push_results.length > 0) {
    const ids = auto_push_results.map((r) => r.id);
    const { data: refetched } = await db
      .from("contacts")
      .select(
        "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
          "linkedin_url, email, phone, seniority, prefilter_result, status, " +
          "fit_action, fit_score, fit_reason, linkedin_icebreaker, email_subject, " +
          "email_body, lemlist_pushed_at, lemlist_push_error, hubspot_contact_id, " +
          "clay_pushed_at, created_at"
      )
      .in("id", ids);
    if (refetched) finalContacts = refetched as typeof finalContacts;
  }

  // Inyectar bandera name_email_mismatch en cada contacto para la UI.
  const contactsWithFlag = (finalContacts as any[]).map((c) => {
    const m = detectNameEmailMismatch(c.first_name, c.last_name, c.email);
    return {
      ...c,
      name_email_mismatch: m.mismatch,
      name_email_mismatch_reason: m.reason ?? null
    };
  });

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    contacts: contactsWithFlag,
    staged_total: leadsRes.leads.length,
    selected_count: selected.length,
    deleted,
    delete_errors,
    matched_url: leadsRes.matched_url,
    auto_pushed_lemlist: autoPushLemlist,
    auto_push_results
  });
}
