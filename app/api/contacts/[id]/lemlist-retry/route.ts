import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist, type LemlistPushContact, type LemlistPushCompany } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/lemlist-retry
// Reintenta el push a Lemlist para un contacto que tuvo error.

const CONTACT_FIELDS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, " +
  "fit_score, fit_reason, linkedin_icebreaker, email_subject, email_body, client_id";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Limpiar el error anterior para permitir el reintento
  await db
    .from("contacts")
    .update({ lemlist_push_error: null })
    .eq("id", id);

  // Cargar contacto completo
  const { data: contactRaw, error: fetchErr } = await db
    .from("contacts")
    .select(CONTACT_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contactRaw) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Cargar empresa
  let company: LemlistPushCompany = null;
  if (contactRaw.company_id) {
    const { data: companyRaw } = await db
      .from("companies")
      .select("company_name, company_size, company_type, tool_primary, tool_secondary, fit_signals")
      .eq("id", contactRaw.company_id)
      .maybeSingle();
    if (companyRaw) {
      company = {
        company_name: companyRaw.company_name,
        company_size: companyRaw.company_size,
        company_type: companyRaw.company_type,
        tool_primary: companyRaw.tool_primary,
        tool_secondary: companyRaw.tool_secondary,
        fit_signals: companyRaw.fit_signals
      };
    }
  }

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

  const result = await pushApprovedToLemlist(db, id, contact, company, {
    clientId: contactRaw.client_id
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    contactId: id,
    lead_id: result.lead_id,
    messages_generated: result.messages_generated
  });
}
