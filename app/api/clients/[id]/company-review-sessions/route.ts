import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// GET — lista sesiones activas del cliente + count de decisiones pendientes de confirmación
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();

  const { data: sessions, error } = await db
    .from("company_review_sessions")
    .select("id, token, label, expires_at, created_at")
    .eq("client_id", params.id)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cuántas empresas del cliente tienen decisión del cliente pendiente de confirmación
  const { count: pendingConfirmCount } = await db
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("client_id", params.id)
    .in("status", ["client_approved", "client_rejected"]);

  return NextResponse.json({
    sessions: sessions ?? [],
    pending_confirm_count: pendingConfirmCount ?? 0,
  });
}

// POST — crea una sesión con todas las empresas pendientes visibles del cliente
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const label: string | null = body.label ?? null;

  const { data: client } = await db
    .from("clients")
    .select("id, name")
    .eq("id", params.id)
    .single();

  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  // Tomar todas las empresas pendientes del cliente
  const { data: pendingCompanies, error: cErr } = await db
    .from("companies")
    .select("id")
    .eq("client_id", params.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!pendingCompanies?.length) {
    return NextResponse.json({ error: "No hay empresas pendientes para compartir" }, { status: 400 });
  }

  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: session, error: sErr } = await db
    .from("company_review_sessions")
    .insert({ client_id: params.id, token, label, expires_at: expiresAt, created_by: "admin" })
    .select("id, token, expires_at")
    .single();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // Insertar items de la sesión
  const items = pendingCompanies.map((c) => ({
    session_id: session.id,
    company_id: c.id,
  }));

  const { error: iErr } = await db.from("company_review_session_items").insert(items);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const url    = `${origin}/review/empresas/${token}`;

  return NextResponse.json({
    session,
    url,
    company_count: pendingCompanies.length,
    client_name: client.name,
  });
}
