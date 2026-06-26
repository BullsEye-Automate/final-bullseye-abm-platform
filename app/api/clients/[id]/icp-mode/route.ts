import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_configs")
    .select("icp_mode")
    .eq("client_id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ icp_mode: data?.icp_mode ?? "general" });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { icp_mode } = await req.json().catch(() => ({}));
  if (!["general", "by_industry"].includes(icp_mode)) {
    return NextResponse.json({ error: "icp_mode inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Upsert: si no existe el registro en client_configs, crearlo
  const { error } = await db
    .from("client_configs")
    .upsert({ client_id: params.id, icp_mode }, { onConflict: "client_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, icp_mode });
}
