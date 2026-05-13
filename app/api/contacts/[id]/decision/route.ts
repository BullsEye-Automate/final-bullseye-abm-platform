import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Veredicto humano sobre un contacto en la cola de revisión manual (score 5-7).
// approved → marca fit_action='enrich' para que el contacto vuelva al flujo de
//   enriquecimiento (Sprint 4 lo empujará a Lemlist).
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
      "id, company_id, job_title, linkedin_headline, fit_score, fit_action, status, human_decision, prefilter_result"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  let companyName: string | null = null;
  let companySize: number | null = null;
  if (contact.company_id) {
    const { data: company } = await db
      .from("companies")
      .select("company_name, company_size")
      .eq("id", contact.company_id)
      .maybeSingle();
    companyName = company?.company_name ?? null;
    companySize = company?.company_size ?? null;
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
          clay_pushed_at: null,
          clay_push_error: null,
          ...(isRecovery
            ? {
                // Recuperación desde Descartados: vuelve a Pendientes como
                // contacto fresco, listo para empujarse a Clay.
                fit_action: null,
                status: "pending",
                ...(contact.prefilter_result === "no" ? { prefilter_result: "yes" } : {})
              }
            : {
                // Aprobación desde Revisión manual (score 5-7 de Clay):
                // el humano decidió enriquecer → marca fit_action=enrich.
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
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, clay_pushed_at, clay_push_error, human_decision, human_decision_at, human_decision_reason, human_decision_by, created_at, updated_at"
    )
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { error: fbErr } = await db.from("contact_feedback").insert({
    contact_id: params.id,
    company_name: companyName,
    job_title: contact.job_title,
    linkedin_headline: contact.linkedin_headline,
    company_size: companySize,
    claude_score: contact.fit_score,
    claude_action: contact.fit_action,
    human_action: body.decision,
    human_reason: body.reason?.trim() || null,
    reviewer
  });
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  return NextResponse.json({ contact: updated });
}
