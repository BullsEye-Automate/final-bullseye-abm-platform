import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ICP_V1_DEFAULTS } from "@/lib/icpDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body     = await req.json().catch(() => ({}));
  const clientId = body.client_id ?? req.nextUrl.searchParams.get("client_id") ?? null;
  const db = supabaseAdmin();

  // Verifica que no exista ya un ICP activo para este cliente
  let activeQ = db.from("icp_config").select("id").eq("is_active", true).limit(1);
  if (clientId) activeQ = activeQ.eq("client_id", clientId);
  const { data: active, error: activeErr } = await activeQ.maybeSingle();
  if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 500 });
  if (active) {
    return NextResponse.json(
      { error: "Ya existe un ICP activo. Usa la pantalla de edición para crear una versión nueva." },
      { status: 409 }
    );
  }

  let latestQ = db
    .from("icp_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1);
  if (clientId) latestQ = latestQ.eq("client_id", clientId);
  const { data: latest, error: latestErr } = await latestQ.maybeSingle();
  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 });
  const nextVersion = (latest?.version ?? 0) + 1;

  const reviewer = process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const { data: inserted, error: insertErr } = await db
    .from("icp_config")
    .insert({
      version:   nextVersion,
      is_active: true,
      client_id: clientId,
      ...ICP_V1_DEFAULTS,
      created_by: reviewer
    })
    .select("*")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ icp: inserted });
}
