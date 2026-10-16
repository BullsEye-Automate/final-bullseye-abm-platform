import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { saveIcpContent } from "@/lib/icpStore";
import { getReviewerEmail } from "@/lib/portalAdmin";

export const dynamic = "force-dynamic";

// POST — { action: "approve" | "reject", note? }
// Aprobar copia la propuesta al ICP vigente (general o de la industria).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }
  const note: string | null = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  const db = supabaseAdmin();
  const { data: request, error } = await db
    .from("icp_change_requests")
    .select("id, client_id, industry_id, proposed_content, status")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!request) return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  if (request.status !== "pending") {
    return NextResponse.json({ error: "La propuesta ya fue revisada" }, { status: 409 });
  }

  if (action === "approve") {
    const { error: saveErr } = await saveIcpContent(db, request.client_id, request.industry_id, request.proposed_content);
    if (saveErr) return NextResponse.json({ error: saveErr }, { status: 500 });
  }

  const { error: updErr } = await db
    .from("icp_change_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      review_note: note,
      reviewed_by: await getReviewerEmail(),
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .eq("status", "pending");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
