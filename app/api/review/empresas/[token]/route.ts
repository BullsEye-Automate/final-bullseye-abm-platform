import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET — valida el token y devuelve las empresas del batch (vista pública)
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db = supabaseAdmin();

  const { data: session, error: sErr } = await db
    .from("company_review_sessions")
    .select("id, client_id, expires_at, label")
    .eq("token", params.token)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  }

  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ error: "Este link ha expirado" }, { status: 410 });
  }

  const { data: client } = await db
    .from("clients")
    .select("name")
    .eq("id", session.client_id)
    .single();

  // Obtener las empresas del batch
  const { data: items } = await db
    .from("company_review_session_items")
    .select("company_id")
    .eq("session_id", session.id);

  const companyIds = (items ?? []).map((i: { company_id: string }) => i.company_id);

  if (!companyIds.length) {
    return NextResponse.json({ companies: [], session_label: session.label, client_name: client?.name });
  }

  const { data: companies, error: cErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, fit_score, fit_signals, research_summary, status, created_at"
    )
    .in("id", companyIds)
    .order("created_at", { ascending: false });

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  return NextResponse.json({
    companies: companies ?? [],
    session_label: session.label,
    client_name: client?.name ?? "",
    expires_at: session.expires_at,
  });
}

// POST — el cliente envía su decisión sobre una empresa
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db   = supabaseAdmin();
  const body = await req.json().catch(() => null);

  if (!body?.company_id || !body?.decision) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const decision: string = body.decision;
  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Decisión inválida" }, { status: 400 });
  }

  // Validar que el token es válido y no expiró
  const { data: session } = await db
    .from("company_review_sessions")
    .select("id, client_id, expires_at")
    .eq("token", params.token)
    .single();

  if (!session) return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ error: "Este link ha expirado" }, { status: 410 });
  }

  // Validar que la empresa pertenece a esta sesión
  const { data: item } = await db
    .from("company_review_session_items")
    .select("id")
    .eq("session_id", session.id)
    .eq("company_id", body.company_id)
    .single();

  if (!item) return NextResponse.json({ error: "Empresa no pertenece a esta sesión" }, { status: 403 });

  // Actualizar el estado de la empresa al estado intermedio del cliente
  const newStatus = decision === "approved" ? "client_approved" : "client_rejected";
  const { error: uErr } = await db
    .from("companies")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", body.company_id)
    .eq("client_id", session.client_id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: newStatus });
}
