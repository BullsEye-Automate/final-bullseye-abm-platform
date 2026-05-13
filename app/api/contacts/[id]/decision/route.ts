import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";

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

  const shouldPushLemlist =
    body.decision === "approved" && !isRecovery && !contact.lemlist_pushed_at;

  if (shouldPushLemlist) {
    lemlist_push = await pushApprovedToLemlist(db, params.id, contact, company);
    // Re-fetch del contacto para devolver el estado actualizado (con
    // mensajes generados / lemlist_pushed_at / lemlist_push_error).
    const { data: refetched } = await db
      .from("contacts")
      .select(
        "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, clay_push_error, lemlist_pushed_at, lemlist_push_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at"
      )
      .eq("id", params.id)
      .single();
    if (refetched) Object.assign(updated as object, refetched);
  }

  return NextResponse.json({ contact: updated, lemlist_push });
}
