import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/contacts/[id]/push-to-lemlist
//
// Empuja un contacto pendiente DIRECTO a Lemlist, salteando Clay. Pensado
// para contactos que ya tienen email (típicamente scrapeados del sitio web
// de la empresa): Clay no aporta nada porque no hay LinkedIn URL para
// enriquecer y el email ya lo tenemos. La app genera icebreaker + email
// con Claude (igual que el approval de revisión manual) y pushea.
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
  if (!contact.email) {
    return NextResponse.json(
      {
        error:
          "Este contacto no tiene email. El push directo a Lemlist necesita email (o usá el flujo de Clay)."
      },
      { status: 400 }
    );
  }
  if (contact.lemlist_pushed_at) {
    return NextResponse.json({ error: "El contacto ya está en Lemlist." }, { status: 409 });
  }
  if (contact.clay_pushed_at) {
    return NextResponse.json(
      {
        error:
          "Este contacto ya fue empujado a Clay. Para evitar doble procesamiento, dejá que siga el flujo de Clay."
      },
      { status: 409 }
    );
  }

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

  const result = await pushApprovedToLemlist(db, params.id, contact, company);

  // Tras un push exitoso, marcamos fit_action='enrich' para que el contacto
  // salga de "Pendientes" y aparezca en "En campaña" (mismo patrón que el
  // approval de revisión manual). pushApprovedToLemlist ya setea
  // lemlist_pushed_at.
  if (result.ok) {
    await db.from("contacts").update({ fit_action: "enrich" }).eq("id", params.id);
  }

  const { data: refetched } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, " +
        "phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, " +
        "fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, " +
        "clay_push_error, lemlist_pushed_at, lemlist_push_error, human_decision, human_decision_at, " +
        "human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .eq("id", params.id)
    .single();

  return NextResponse.json({ contact: refetched, lemlist_push: result });
}
