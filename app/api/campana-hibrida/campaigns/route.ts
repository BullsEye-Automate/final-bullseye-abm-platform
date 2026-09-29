import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/campana-hibrida/campaigns?client_id=xxx
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("hybrid_campaigns")
    .select("id, name, lemlist_campaign_name, status, contacts, created_at, updated_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

// POST /api/campana-hibrida/campaigns — crear campaña nueva
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const { client_id, name, lemlist_campaign_id, lemlist_campaign_name } = body;
  if (!client_id || !name)
    return NextResponse.json({ error: "Se requieren client_id y name" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("hybrid_campaigns")
    .insert({ client_id, name, lemlist_campaign_id, lemlist_campaign_name, status: "draft" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
