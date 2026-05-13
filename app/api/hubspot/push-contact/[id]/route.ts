import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  pushContactToHubSpot,
  pushCompanyToHubSpot,
  type HubSpotContactInput,
  type HubSpotCompanyInput
} from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reintenta el push de un contacto a HubSpot. Si la empresa asociada
// todavía no fue sincronizada, también la pushea (orden contacto-empresa
// requiere que ambas existan para asociar). Idempotente: si ya está
// sincronizado, hace un update con los datos actuales.

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, email, phone, linkedin_url, fit_score, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, human_decision, human_decision_reason, clay_pushed_at, lemlist_pushed_at, hubspot_contact_id"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  let hubspotCompanyId: string | null = null;
  let companySnapshot: {
    company_type: string | null;
    cad_software: string | null;
    scanner_technology: string | null;
  } | null = null;
  if (contact.company_id) {
    const { data: company } = await db
      .from("companies")
      .select(
        "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, approved_at, clay_pushed_at, hubspot_company_id"
      )
      .eq("id", contact.company_id)
      .maybeSingle();
    if (company) {
      const cInput: HubSpotCompanyInput = company as HubSpotCompanyInput;
      const cRes = await pushCompanyToHubSpot(db, cInput);
      if (cRes.ok) hubspotCompanyId = cRes.hubspot_id;
      companySnapshot = {
        company_type: company.company_type,
        cad_software: company.cad_software,
        scanner_technology: company.scanner_technology
      };
    }
  }

  const result = await pushContactToHubSpot(
    db,
    contact as HubSpotContactInput,
    hubspotCompanyId,
    companySnapshot
  );

  const { data: refetched } = await db
    .from("contacts")
    .select("id, hubspot_contact_id, hubspot_synced_at, hubspot_sync_error")
    .eq("id", params.id)
    .single();

  return NextResponse.json({ contact: refetched, hubspot_push: result });
}
