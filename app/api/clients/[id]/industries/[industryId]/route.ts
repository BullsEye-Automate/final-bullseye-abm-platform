import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; industryId: string } }) {
  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.sort_order === "number") updates.sort_order = body.sort_order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("icp_industries")
    .update(updates)
    .eq("id", params.industryId)
    .eq("client_id", params.id)
    .select("id, name, sort_order")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ industry: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; industryId: string } }) {
  const db = supabaseAdmin();
  const { error } = await db
    .from("icp_industries")
    .delete()
    .eq("id", params.industryId)
    .eq("client_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
