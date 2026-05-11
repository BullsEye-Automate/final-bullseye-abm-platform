import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, IcpConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("icp_config")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ icp: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<IcpConfig> & { reviewer?: string };
  const db = supabaseAdmin();

  const { data: current, error: curErr } = await db
    .from("icp_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });
  const nextVersion = (current?.version ?? 0) + 1;

  const { error: deactivateErr } = await db
    .from("icp_config")
    .update({ is_active: false })
    .eq("is_active", true);
  if (deactivateErr) return NextResponse.json({ error: deactivateErr.message }, { status: 500 });

  const reviewer = body.reviewer || process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const insertPayload = {
    version: nextVersion,
    is_active: true,
    org_types: body.org_types ?? [],
    signals_strong: body.signals_strong ?? [],
    signals_medium: body.signals_medium ?? [],
    signals_weak: body.signals_weak ?? [],
    size_rules: body.size_rules ?? [],
    pipeline_mix: body.pipeline_mix ?? [],
    competitors: body.competitors ?? [],
    geographies: body.geographies ?? [],
    notes: body.notes ?? "",
    created_by: reviewer
  };

  const { data: inserted, error: insertErr } = await db
    .from("icp_config")
    .insert(insertPayload)
    .select("*")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ icp: inserted });
}
