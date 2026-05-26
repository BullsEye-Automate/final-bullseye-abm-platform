import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/discard
// Descarta manualmente un contacto e inserta contact_feedback.
// Body opcional: { reason?: string, by?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let reason: string | null = null;
  let by: string | null = null;
  try {
    const body = await req.json();
    reason = body?.reason ?? null;
    by = body?.by ?? null;
  } catch {
    // Body opcional — ignorar error de parseo
  }

  const db = supabaseAdmin();

  const { error } = await db
    .from("contacts")
    .update({
      status: "discarded",
      human_decision: "rejected",
      human_decision_at: new Date().toISOString(),
      human_decision_reason: reason,
      human_decision_by: by ?? "manual",
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Insertar feedback
  await db.from("contact_feedback").insert({
    contact_id: id,
    decision: "rejected",
    reason: reason ?? null,
    decided_by: by ?? "manual",
    decided_at: new Date().toISOString()
  }).then(() => {}).catch(() => {});

  return NextResponse.json({ ok: true, contactId: id, discarded: true });
}
