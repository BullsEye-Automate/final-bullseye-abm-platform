import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  if (!body?.decision)
    return NextResponse.json({ error: "decision requerido" }, { status: 400 });

  const db = supabaseAdmin();
  const { decision, reason } = body as {
    decision: "rejected" | "recovered";
    reason?: string;
  };

  if (decision === "rejected") {
    const { data, error } = await db
      .from("contacts")
      .update({ status: "discarded", human_decision: "rejected" })
      .eq("id", params.id)
      .select("id, status, human_decision")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Registrar feedback (tabla opcional — ignorar si no existe)
    await db
      .from("contact_feedback")
      .insert({
        contact_id: params.id,
        human_action: "rejected",
        human_reason: reason ?? null,
        reviewer: "user"
      })
      .catch(() => {});

    return NextResponse.json({ contact: data });
  }

  if (decision === "recovered") {
    const { data, error } = await db
      .from("contacts")
      .update({ status: "pending", human_decision: null, fit_action: null })
      .eq("id", params.id)
      .select("id, status")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ contact: data });
  }

  return NextResponse.json({ error: "decision inválido" }, { status: 400 });
}
