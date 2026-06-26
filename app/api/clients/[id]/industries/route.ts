import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("icp_industries")
    .select("id, name, sort_order, created_at")
    .eq("client_id", params.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ industries: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { name } = await req.json().catch(() => ({}));
  if (!name?.trim()) {
    return NextResponse.json({ error: "El nombre de la industria es requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Asignar sort_order = max existente + 1
  const { data: existing } = await db
    .from("icp_industries")
    .select("sort_order")
    .eq("client_id", params.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sort_order = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await db
    .from("icp_industries")
    .insert({ client_id: params.id, name: name.trim(), sort_order })
    .select("id, name, sort_order, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ industry: data });
}
