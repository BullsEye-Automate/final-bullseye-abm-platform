// Bulk approve de contactos del bucket "Por aprobar" o "Revisión manual".
// Por cada uno:
//   1. Si viene de manual_review (fit_action='manual_review' y human_decision=null):
//      marca human_decision='approved' + fit_action='enrich' + persiste
//      en contact_feedback (loop de entrenamiento).
//   2. Generar mensajes si no hay (config activa aplica).
//   3. Push a Lemlist via pushApprovedToLemlist.
//   4. Sync a HubSpot.
//
// Cuando se llama sin contact_ids agarra solo el bucket "Por aprobar"
// (fit_action='enrich', backward compat). Cuando se llama con
// contact_ids explícitos, acepta también manual_review.

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
export const maxDuration = 300;

const DEFAULT_LIMIT = 25;
const CONCURRENCY = 3;

type Body = {
  contact_ids?: string[];
  // Si no se pasan ids, agarra todo el bucket "approved_pending" (hasta limit).
  batch_limit?: number;
};

type PerResult = {
  id: string;
  contact_name: string;
  company_name: string | null;
  lemlist: "pushed" | "error" | "skipped";
  lemlist_error?: string;
  hubspot: "synced" | "error" | "skipped";
  hubspot_error?: string;
};

const CONTACT_COLS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
  "linkedin_url, email, phone, seniority, fit_score, fit_reason, fit_action, " +
  "linkedin_icebreaker, email_subject, email_body, status, human_decision, " +
  "lemlist_pushed_at, hubspot_contact_id";

const COMPANY_COLS =
  "id, company_name, company_website, company_linkedin_url, company_city, " +
  "company_country, company_size, company_type, cad_software, scanner_technology, " +
  "fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.min(Math.max(1, body.batch_limit ?? DEFAULT_LIMIT), 100);

  const db = supabaseAdmin();

  // Selección: si llegan ids explícitos aceptamos enrich + manual_review
  // (el caller sabe qué pidió). Si no llegan ids, solo bucket "Por aprobar"
  // (fit_action='enrich') con cap.
  const hasExplicitIds = Array.isArray(body.contact_ids) && body.contact_ids.length > 0;
  let query: any = db
    .from("contacts")
    .select(CONTACT_COLS)
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded")
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (hasExplicitIds) {
    query = query.in("id", body.contact_ids!).in("fit_action", ["enrich", "manual_review"]);
  } else {
    query = query.eq("fit_action", "enrich").limit(limit);
  }

  const { data: contactsRaw, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const contacts = (contactsRaw ?? []) as any[];

  if (contacts.length === 0) {
    return NextResponse.json({
      summary: { processed: 0, pushed: 0, errors: 0, hubspot_synced: 0 },
      results: []
    });
  }

  // Cargamos las empresas en una sola query.
  const companyIds = Array.from(new Set(contacts.map((c) => c.company_id))).filter(Boolean);
  const { data: companiesRaw } = await db
    .from("companies")
    .select(COMPANY_COLS)
    .in("id", companyIds);
  const companyById = new Map<string, any>();
  for (const co of (companiesRaw ?? []) as any[]) companyById.set(co.id, co);

  const results: PerResult[] = [];
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const chunk = contacts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (c): Promise<PerResult> => {
        const fullName =
          [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)";
        const company = companyById.get(c.company_id);
        if (!company) {
          return {
            id: c.id,
            contact_name: fullName,
            company_name: null,
            lemlist: "skipped",
            lemlist_error: "Sin empresa asociada",
            hubspot: "skipped"
          };
        }

        // Si el contacto viene de Revisión manual y no fue decidido, aplicar
        // la transición manual_review → enrich + persistir feedback. Equivale
        // a llamar /api/contacts/[id]/decision con approved en bulk.
        if (c.fit_action === "manual_review" && c.human_decision == null) {
          const nowIso = new Date().toISOString();
          await db
            .from("contacts")
            .update({
              fit_action: "enrich",
              human_decision: "approved",
              human_decision_at: nowIso,
              human_decision_by: process.env.APP_DEFAULT_REVIEWER_EMAIL ?? "system"
            })
            .eq("id", c.id);
          await db.from("contact_feedback").insert({
            contact_id: c.id,
            company_name: company.company_name,
            job_title: c.job_title,
            linkedin_headline: c.linkedin_headline,
            company_size: company.company_size ?? null,
            company_type: company.company_type ?? null,
            claude_score: c.fit_score ?? null,
            claude_reason: c.fit_reason ?? null,
            claude_action: "manual_review",
            human_action: "approved",
            human_reason: "bulk-approve desde Revisión manual",
            reviewer: process.env.APP_DEFAULT_REVIEWER_EMAIL ?? "system",
            decided_at: nowIso
          });
          // Reflejar el cambio in-memory antes del push.
          c.fit_action = "enrich";
          c.human_decision = "approved";
        }

        // 1. Push a Lemlist. force_regenerate=true ignora mensajes viejos
        // (legacy de Clay) y regenera con la config activa de /entrenar-modelo.
        const lemlist = await pushApprovedToLemlist(
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
          {
            company_name: company.company_name,
            company_size: company.company_size,
            company_type: company.company_type,
            cad_software: company.cad_software,
            scanner_technology: company.scanner_technology,
            fit_signals: company.fit_signals
          },
          { force_regenerate: true }
        );

        const lemlistStatus: PerResult["lemlist"] = lemlist.ok ? "pushed" : "error";
        const lemlistErr = !lemlist.ok ? lemlist.error : undefined;

        // 2. Sync a HubSpot (push de empresa primero, luego contacto).
        let hubspotStatus: PerResult["hubspot"] = "skipped";
        let hubspotErr: string | undefined;
        try {
          const cRes = await pushCompanyToHubSpot(db, company as unknown as HubSpotCompanyInput);
          const hubspotCompanyId = cRes.ok ? cRes.hubspot_id : null;
          // Recargamos el contacto para tener los mensajes recién persistidos
          // (pushApprovedToLemlist los grabó si los generó).
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
            hubspotCompanyId,
            {
              company_type: company.company_type ?? null,
              cad_software: company.cad_software ?? null,
              scanner_technology: company.scanner_technology ?? null
            }
          );
          if (hsRes.ok) {
            hubspotStatus = "synced";
          } else {
            hubspotStatus = "error";
            hubspotErr = hsRes.error;
          }
        } catch (err) {
          hubspotStatus = "error";
          hubspotErr = err instanceof Error ? err.message : "HubSpot sync failed";
        }

        return {
          id: c.id,
          contact_name: fullName,
          company_name: company.company_name,
          lemlist: lemlistStatus,
          lemlist_error: lemlistErr,
          hubspot: hubspotStatus,
          hubspot_error: hubspotErr
        };
      })
    );
    results.push(...chunkResults);
  }

  const summary = {
    processed: results.length,
    pushed: results.filter((r) => r.lemlist === "pushed").length,
    errors: results.filter((r) => r.lemlist === "error").length,
    hubspot_synced: results.filter((r) => r.hubspot === "synced").length,
    hubspot_errors: results.filter((r) => r.hubspot === "error").length
  };

  return NextResponse.json({ summary, results });
}
