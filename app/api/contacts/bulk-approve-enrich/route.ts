import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist, type LemlistPushContact, type LemlistPushCompany } from "@/lib/lemlistPush";
import { pushCompanyToHubSpot, pushContactToHubSpot, type HubSpotCompanyInput, type HubSpotContactInput } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/bulk-approve-enrich
// Aprueba en masa los contactos de manual_review y los empuja a Lemlist + HubSpot.
// Body: { contact_ids?: string[], client_id?: string }
// Si no se pasan contact_ids, aprueba todos los de manual_review (sin human_decision).

const CONCURRENCY = 3;
const DEFAULT_LIMIT = 25;

const CONTACT_FIELDS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, " +
  "fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, " +
  "human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, " +
  "phone_enrichment_status, phone_source, hubspot_contact_id, client_id, status";

const COMPANY_FIELDS =
  "id, company_name, company_website, company_linkedin_url, company_city, company_country, " +
  "company_size, company_type, tool_primary, tool_secondary, fit_signals, fit_score, " +
  "approved_at, clay_pushed_at, hubspot_company_id";

export async function POST(req: NextRequest) {
  let body: { contact_ids?: string[]; client_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body opcional
  }

  const db = supabaseAdmin();

  // Construir query de contactos a aprobar
  let query = db
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("fit_action", "manual_review")
    .is("human_decision", null);

  if (body.client_id) {
    query = query.eq("client_id", body.client_id);
  }
  if (body.contact_ids?.length) {
    query = query.in("id", body.contact_ids);
  }

  const { data: contacts, error: fetchErr } = await query.limit(DEFAULT_LIMIT);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ ok: true, total: 0, approved: 0, errors: [] });
  }

  // Cargar todas las empresas de una vez
  const companyIds = [...new Set(contacts.map((c: any) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select(COMPANY_FIELDS)
    .in("id", companyIds);

  const companyMap = new Map<string, any>(
    (companies ?? []).map((co: any) => [co.id, co])
  );

  const results: { contactId: string; ok: boolean; error?: string }[] = [];

  // Procesar en chunks de CONCURRENCY
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const chunk = contacts.slice(i, i + CONCURRENCY) as any[];
    await Promise.all(chunk.map(async (contactRaw) => {
      const companyRaw = companyMap.get(contactRaw.company_id);
      const clientId = (contactRaw.client_id ?? companyRaw?.client_id ?? body.client_id) as string | null;

      try {
        // Registrar aprobación humana y transicionar fit_action
        await db.from("contacts").update({
          human_decision: "approved",
          human_decision_at: new Date().toISOString(),
          human_decision_by: "bulk",
          fit_action: "enrich"
        }).eq("id", contactRaw.id);

        try {
          await db.from("contact_feedback").insert({
            contact_id: contactRaw.id, decision: "approved",
            reason: "bulk_approve", decided_by: "bulk",
            decided_at: new Date().toISOString()
          });
        } catch { /* no-op */ }

        const company: LemlistPushCompany = companyRaw ? {
          company_name: companyRaw.company_name,
          company_size: companyRaw.company_size,
          company_type: companyRaw.company_type,
          tool_primary: companyRaw.tool_primary,
          tool_secondary: companyRaw.tool_secondary,
          fit_signals: companyRaw.fit_signals
        } : null;

        const contact: LemlistPushContact = {
          first_name: contactRaw.first_name,
          last_name: contactRaw.last_name,
          job_title: contactRaw.job_title,
          linkedin_headline: contactRaw.linkedin_headline,
          linkedin_url: contactRaw.linkedin_url,
          email: contactRaw.email,
          phone: contactRaw.phone,
          seniority: contactRaw.seniority,
          fit_score: contactRaw.fit_score,
          fit_reason: contactRaw.fit_reason,
          linkedin_icebreaker: contactRaw.linkedin_icebreaker,
          email_subject: contactRaw.email_subject,
          email_body: contactRaw.email_body
        };

        // Push a Lemlist con force_regenerate
        const lemlistResult = await pushApprovedToLemlist(db, contactRaw.id, contact, company, {
          force_regenerate: true,
          clientId
        });

        // Sync a HubSpot (no bloquear)
        if (companyRaw) {
          pushCompanyToHubSpot(db, companyRaw as HubSpotCompanyInput)
            .then((cRes) => {
              const hubspotCompanyId = cRes.ok ? cRes.hubspot_id : null;
              return pushContactToHubSpot(
                db,
                contactRaw as unknown as HubSpotContactInput,
                hubspotCompanyId,
                companyRaw ? { company_type: companyRaw.company_type, tool_primary: companyRaw.tool_primary, tool_secondary: companyRaw.tool_secondary } : null
              );
            })
            .catch((err) => {
              console.error(`[bulk-approve] Error HubSpot para ${contactRaw.id}:`, err);
            });
        }

        if (lemlistResult.ok) {
          results.push({ contactId: contactRaw.id, ok: true });
        } else {
          results.push({ contactId: contactRaw.id, ok: false, error: lemlistResult.error });
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ contactId: contactRaw.id, ok: false, error });
      }
    }));
  }

  const approved = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    total: contacts.length,
    approved,
    errors: errors.length > 0 ? errors : [],
  });
}
