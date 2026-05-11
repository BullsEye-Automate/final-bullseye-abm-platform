import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ICP_V1_DEFAULTS } from "@/lib/icpDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const db = supabaseAdmin();

  const { data: existing, error: existingErr } = await db
    .from("icp_config")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe un ICP. Usa la pantalla de edición para crear una versión nueva." },
      { status: 409 }
    );
  }

  const reviewer = process.env.APP_DEFAULT_REVIEWER_EMAIL || "system";
  const { data: inserted, error: insertErr } = await db
    .from("icp_config")
    .insert({
      version: 1,
      is_active: true,
      ...ICP_V1_DEFAULTS,
      created_by: reviewer
    })
    .select("*")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ icp: inserted });
}
