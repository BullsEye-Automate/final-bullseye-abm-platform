import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/calls/by-ids
// Body: { ids: string[] }
//
// Devuelve info compacta (sin transcripción ni body) para mostrar en los
// drilldowns de reportería. Limita a 200 ids para evitar abusos.
export async function POST(req: NextRequest) {
  let body: { ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
  if (ids.length === 0) return NextResponse.json({ calls: [] });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("calls")
    .select(
      "id, call_timestamp, direction, duration_ms, owner_name, " +
        "customer_response_category, customer_response_label, customer_response_summary, " +
        "sdr_score_overall, recommended_next_step, has_transcription, " +
        "contact:contacts(id, first_name, last_name, job_title, " +
        "  company:companies(id, company_name)), " +
        "company:companies(id, company_name)"
    )
    .in("id", ids)
    .order("call_timestamp", { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
