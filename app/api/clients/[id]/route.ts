import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const updates: Record<string, any> = {};
  if (body.name !== undefined)     updates.name     = body.name.trim();
  if (body.logo_url !== undefined)  updates.logo_url  = body.logo_url || null;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.slug !== undefined) {
    updates.slug = body.slug
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .update(updates)
    .eq("id", params.id)
    .select("id, name, slug, logo_url, is_active, created_at")
    .single();

  if (error) {
    const msg = error.code === "23505"
      ? "Ya existe un cliente con ese slug"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ client: data });
}
