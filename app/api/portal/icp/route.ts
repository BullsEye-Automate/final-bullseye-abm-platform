import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { getClientIndustry, listClientIndustries, loadIcpContent } from "@/lib/icpStore";

export const dynamic = "force-dynamic";

// GET — ICP vigente del cliente de la sesión + propuesta pendiente (si hay)
// + historial reciente de propuestas. ?industry_id= para el ICP de una industria.
export async function GET(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const db = supabaseAdmin();
  const industryId = req.nextUrl.searchParams.get("industry_id") || null;

  const industries = await listClientIndustries(db, user.clientId);
  if (industryId && !industries.some((i) => i.id === industryId)) {
    return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
  }

  const current = await loadIcpContent(db, user.clientId, industryId);

  let pendingQ = db
    .from("icp_change_requests")
    .select("id, proposed_content, client_comment, submitted_by_email, created_at, updated_at")
    .eq("client_id", user.clientId)
    .eq("status", "pending");
  pendingQ = industryId ? pendingQ.eq("industry_id", industryId) : pendingQ.is("industry_id", null);
  const { data: pending } = await pendingQ.maybeSingle();

  let historyQ = db
    .from("icp_change_requests")
    .select("id, status, client_comment, review_note, submitted_by_email, created_at, reviewed_at")
    .eq("client_id", user.clientId)
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  historyQ = industryId ? historyQ.eq("industry_id", industryId) : historyQ.is("industry_id", null);
  const { data: history } = await historyQ;

  return NextResponse.json(
    { industries, current, pending: pending ?? null, history: history ?? [] },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

// POST — envía una propuesta de cambio. No toca el ICP vigente: queda
// pendiente hasta que BullsEye la apruebe en Sistema → ICP (Propuestas del portal).
// Si ya hay una pendiente para el mismo ICP, se reemplaza su contenido.
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const content: string = typeof body?.content === "string" ? body.content : "";
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  const industryId: string | null = body?.industry_id || null;
  if (!content.trim()) return NextResponse.json({ error: "Contenido vacío" }, { status: 400 });

  const db = supabaseAdmin();
  if (industryId && !(await getClientIndustry(db, user.clientId, industryId))) {
    return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
  }

  const current = await loadIcpContent(db, user.clientId, industryId);
  if (current.trim() === content.trim()) {
    return NextResponse.json({ error: "No hay cambios respecto del ICP vigente" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const fields = {
    previous_content: current,
    proposed_content: content,
    client_comment: comment,
    submitted_by: user.portalUserId,
    submitted_by_email: user.email,
    updated_at: now,
  };

  let pendingQ = db
    .from("icp_change_requests")
    .select("id")
    .eq("client_id", user.clientId)
    .eq("status", "pending");
  pendingQ = industryId ? pendingQ.eq("industry_id", industryId) : pendingQ.is("industry_id", null);
  const { data: pending } = await pendingQ.maybeSingle();

  const { data, error } = pending
    ? await db.from("icp_change_requests").update(fields).eq("id", pending.id).select("id").single()
    : await db
        .from("icp_change_requests")
        .insert({ ...fields, client_id: user.clientId, industry_id: industryId, status: "pending" })
        .select("id")
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
