import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ICP_V1_DEFAULTS } from "@/lib/icpDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const db = supabaseAdmin();

  const { data: active, error: activeErr } = await db
    .from("icp_config")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 500 });
  if (active) {
    return NextResponse.json(
      { error: "Ya existe un ICP activo. Usa la pantalla de edición para crear una versión nueva." },
      { status: 409 }
    );
  }

  const { data: latest, error: latestErr } = await db
    .from("icp_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 });
  const nextVersion = (latest?.version ?? 0) + 1;

  const reviewer = process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const { data: inserted, error: insertErr } = await db
    .from("icp_config")
    .insert({
      version: nextVersion,
      is_active: true,
      ...ICP_V1_DEFAULTS,
      created_by: reviewer
    })
    .select("*")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ icp: inserted });
}
