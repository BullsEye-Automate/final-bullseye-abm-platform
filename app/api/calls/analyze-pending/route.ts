import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { analyzeCall } from "@/lib/callAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/calls/analyze-pending
// Body opcional: { limit?: number, chunk_size?: number }
// Procesa hasta `limit` calls con analyzed_at IS NULL y analysis_error IS NULL,
// en paralelo de a `chunk_size` para no saturar Anthropic ni el timeout de Vercel.
// Defaults: limit=20, chunk_size=5.

type PendingCall = {
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

type ContactRow = { first_name: string | null; last_name: string | null; job_title: string | null };
type CompanyRow = {
  company_name: string | null;
  company_type: string | null;
  company_size: number | null;
  cad_software: string | null;
};

export async function POST(req: NextRequest) {
  let body: { limit?: number; chunk_size?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
  const chunkSize = Math.min(Math.max(body.chunk_size ?? 5, 1), 10);

  const db = supabaseAdmin();

  // Total pendientes (para devolver lo que queda)
  const { count: totalPending } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .is("analyzed_at", null)
    .is("analysis_error", null);

  const { data: pendingRaw, error } = await db
    .from("calls")
    .select(
      "id, transcription, body, direction, duration_ms, disposition_label, status, " +
        "owner_name, contact_id, company_id"
    )
    .is("analyzed_at", null)
    .is("analysis_error", null)
    .order("call_timestamp", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pending = (pendingRaw ?? []) as unknown as PendingCall[];

  let analyzed = 0;
  let failed = 0;
  const errors: Array<{ id: string; message: string }> = [];

  async function processOne(call: PendingCall) {
    try {
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
        const cnt = cntRaw as unknown as ContactRow | null;
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
        const cmp = cmpRaw as unknown as CompanyRow | null;
        if (cmp) {
          companyName = cmp.company_name ?? null;
          companyType = cmp.company_type ?? null;
          companySize = cmp.company_size ?? null;
          cadSoftware = cmp.cad_software ?? null;
        }
      }

      const analysis = await analyzeCall({
        contact_name: contactName,
        contact_title: contactTitle,
        company_name: companyName,
        company_type: companyType,
        company_size: companySize,
        cad_software: cadSoftware,
        sdr_name: call.owner_name,
        direction: call.direction,
        duration_sec: call.duration_ms != null ? Math.round(Number(call.duration_ms) / 1000) : null,
        disposition_label: call.disposition_label,
        status: call.status,
        transcription: call.transcription,
        notes: call.body
      });

      await db
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
        .eq("id", call.id);
      analyzed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : "Analyze error";
      errors.push({ id: call.id, message: msg });
      await db.from("calls").update({ analysis_error: msg.slice(0, 500) }).eq("id", call.id);
    }
  }

  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    await Promise.all(chunk.map(processOne));
  }

  const remaining = Math.max((totalPending ?? 0) - analyzed, 0);
  return NextResponse.json({
    ok: failed === 0 || analyzed > 0,
    processed: pending.length,
    analyzed,
    failed,
    remaining,
    errors: errors.slice(0, 10)
  });
}
