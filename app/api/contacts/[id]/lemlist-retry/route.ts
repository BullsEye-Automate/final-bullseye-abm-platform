import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reintenta empujar un contacto a Lemlist. Sirve para contactos que ya
// fueron aprobados (human_decision='approved') pero cuyo push original
// falló por un error transitorio del API de Lemlist. La UI muestra un
// botón "Reintentar Lemlist" cuando lemlist_push_error está set.
//
// Body opcional { force: true }: re-empuja un contacto que YA está en
// Lemlist (lemlist_pushed_at set). Útil para arreglar leads que se
// empujaron con el icebreaker en blanco (bug previo): pushApprovedToLemlist
// regenera los mensajes si están vacíos y vuelve a empujar — Lemlist
// upsertea el lead por email/linkedinUrl, así que actualiza el existente.

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const body = (await req.json().catch(() => null)) as { force?: boolean } | null;
  const force = body?.force === true;

  const { data: contact, error: fetchErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, fit_score, fit_reason, linkedin_icebreaker, email_subject, email_body, human_decision, lemlist_pushed_at"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // En modo force aceptamos cualquier contacto que ya esté (o haya estado)
  // encaminado a Lemlist; si no, exigimos approval de revisión manual.
  if (contact.human_decision !== "approved" && !(force && contact.lemlist_pushed_at)) {
    return NextResponse.json(
      { error: "Only manual-review approved contacts can be re-pushed to Lemlist" },
      { status: 400 }
    );
  }
  if (contact.lemlist_pushed_at && !force) {
    return NextResponse.json(
      { error: "Contact already in Lemlist" },
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

  // Devolvemos el contacto actualizado para que la UI pueda refrescar.
  const { data: refetched } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, clay_push_error, lemlist_pushed_at, lemlist_push_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .eq("id", params.id)
    .single();

  return NextResponse.json({ contact: refetched, lemlist_push: result });
}
