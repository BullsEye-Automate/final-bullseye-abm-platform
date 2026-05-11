import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  decision: "approved" | "rejected";
  reason?: string;
  reviewer?: string;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as Body;
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }
  if (body.decision === "rejected" && !body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required when rejecting" }, { status: 400 });
  }

  const reviewer = body.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const db = supabaseAdmin();

  const { data: company, error: fetchErr } = await db
    .from("companies")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const update =
    body.decision === "approved"
      ? {
          status: "approved" as const,
          approved_by: reviewer,
          approved_at: new Date().toISOString(),
          reject_reason: null
        }
      : {
          status: "rejected" as const,
          reject_reason: body.reason!,
          approved_by: null,
          approved_at: null
        };

  const { data: updated, error: updateErr } = await db
    .from("companies")
    .update(update)
    .eq("id", params.id)
    .select("*")
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { error: fbErr } = await db.from("company_feedback").insert({
    company_id: params.id,
    reviewer,
    decision: body.decision,
    reason: body.reason ?? null,
    ai_fit_score: company.fit_score,
    ai_fit_signals: company.fit_signals,
    icp_version: company.icp_version
  });
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  return NextResponse.json({ company: updated });
}
