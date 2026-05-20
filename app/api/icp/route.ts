import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") || null;
  const db = supabaseAdmin();

  let q = db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1);
  if (clientId) q = q.eq("client_id", clientId);

  const { data, error } = await q.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { icp: data },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  const body     = (await req.json()) as Partial<IcpConfig> & { reviewer?: string; client_id?: string };
  const clientId = body.client_id ?? null;
  const db = supabaseAdmin();

  // Versión siguiente dentro del mismo cliente
  let verQ = db
    .from("icp_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1);
  if (clientId) verQ = verQ.eq("client_id", clientId);
  const { data: current, error: curErr } = await verQ.maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });
  const nextVersion = (current?.version ?? 0) + 1;

  // Desactiva solo el ICP activo del mismo cliente
  let deactivateQ = db.from("icp_config").update({ is_active: false }).eq("is_active", true);
  if (clientId) deactivateQ = deactivateQ.eq("client_id", clientId);
  const { error: deactivateErr } = await deactivateQ;
  if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });

  const reviewer = body.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const { data: inserted, error: insertErr } = await db
    .from("icp_config")
    .insert({
      version:        nextVersion,
      is_active:      true,
      client_id:      clientId,
      org_types:      body.org_types      ?? [],
      signals_strong: body.signals_strong ?? [],
      signals_medium: body.signals_medium ?? [],
      signals_weak:   body.signals_weak   ?? [],
      size_rules:     body.size_rules     ?? [],
      pipeline_mix:   body.pipeline_mix   ?? [],
      competitors:    body.competitors    ?? [],
      geographies:    body.geographies    ?? [],
      notes:          body.notes          ?? "",
      created_by:     reviewer
    })
    .select("*")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ icp: inserted });
}
