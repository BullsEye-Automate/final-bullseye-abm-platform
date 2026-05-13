import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { analyzeCall } from "@/lib/callAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/calls/[id]/analyze — re-corre el análisis de Claude sobre una
// llamada existente (útil cuando se editaron las notas o llegó la
// transcripción tarde).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  type CallRow = {
    id: string;
    transcription: string | null;
    body: string | null;
    direction: string | null;
    duration_ms: number | null;
    disposition_label: string | null;
    status: string | null;
    owner_name: string | null;
    contact_id: string | null;
    company_id: string | null;
  };
  const { data: callRaw, error: fetchErr } = await db
    .from("calls")
    .select(
      "id, transcription, body, direction, duration_ms, disposition_label, status, owner_name, " +
        "contact_id, company_id"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!callRaw) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  const call = callRaw as unknown as CallRow;

  let contactName: string | null = null;
  let contactTitle: string | null = null;
  let companyName: string | null = null;
  let companyType: string | null = null;
  let companySize: number | null = null;
  let cadSoftware: string | null = null;

  if (call.contact_id) {
    const { data: cntRaw } = await db
      .from("contacts")
      .select("first_name, last_name, job_title")
      .eq("id", call.contact_id)
      .maybeSingle();
    const cnt = cntRaw as
      | { first_name: string | null; last_name: string | null; job_title: string | null }
      | null;
    if (cnt) {
      contactName = [cnt.first_name, cnt.last_name].filter(Boolean).join(" ") || null;
      contactTitle = cnt.job_title ?? null;
    }
  }
  if (call.company_id) {
    const { data: cmpRaw } = await db
      .from("companies")
      .select("company_name, company_type, company_size, cad_software")
      .eq("id", call.company_id)
      .maybeSingle();
    const cmp = cmpRaw as
      | {
          company_name: string | null;
          company_type: string | null;
          company_size: number | null;
          cad_software: string | null;
        }
      | null;
    if (cmp) {
      companyName = cmp.company_name ?? null;
      companyType = cmp.company_type ?? null;
      companySize = cmp.company_size ?? null;
      cadSoftware = cmp.cad_software ?? null;
    }
  }

  try {
    const analysis = await analyzeCall({
      contact_name: contactName,
      contact_title: contactTitle,
      company_name: companyName,
      company_type: companyType,
      company_size: companySize,
      cad_software: cadSoftware,
      sdr_name: call.owner_name ?? null,
      direction: call.direction ?? null,
      duration_sec: call.duration_ms != null ? Math.round(Number(call.duration_ms) / 1000) : null,
      disposition_label: call.disposition_label ?? null,
      status: call.status ?? null,
      transcription: call.transcription ?? null,
      notes: call.body ?? null
    });

    const { data: updated, error: updErr } = await db
      .from("calls")
      .update({
        analyzed_at: new Date().toISOString(),
        analysis_model: analysis.model_used,
        analysis_error: null,
        customer_response_category: analysis.customer_response.category,
        customer_response_label: analysis.customer_response.label,
        customer_response_summary: analysis.customer_response.summary,
        sdr_score_overall: analysis.sdr_evaluation.overall_score,
        sdr_score_opening: analysis.sdr_evaluation.opening,
        sdr_score_discovery: analysis.sdr_evaluation.discovery,
        sdr_score_objection: analysis.sdr_evaluation.objection_handling,
        sdr_score_next_step: analysis.sdr_evaluation.next_step,
        sdr_strengths: analysis.sdr_evaluation.strengths,
        sdr_improvements: analysis.sdr_evaluation.improvements,
        recommended_next_step: analysis.recommended_next_step
      })
      .eq("id", params.id)
      .select()
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, analysis, call: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analyze error";
    await db.from("calls").update({ analysis_error: msg }).eq("id", params.id);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
