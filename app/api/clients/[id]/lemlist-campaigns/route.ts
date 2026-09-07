import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

// GET — campañas asignadas a este cliente
export async function GET(_req: NextRequest, { params }: Params) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_lemlist_campaigns")
    .select("id, campaign_id, campaign_name, is_active")
    .eq("client_id", params.id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

// POST — asignar campaña
export async function POST(req: NextRequest, { params }: Params) {
  const { campaign_id, campaign_name } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "Se requiere campaign_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db.from("client_lemlist_campaigns").upsert(
    { client_id: params.id, campaign_id, campaign_name: campaign_name ?? null, is_active: true },
    { onConflict: "client_id,campaign_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — quitar campaña (body: { campaign_id })
export async function DELETE(req: NextRequest, { params }: Params) {
  const { campaign_id } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "Se requiere campaign_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("client_lemlist_campaigns")
    .delete()
    .eq("client_id", params.id)
    .eq("campaign_id", campaign_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
