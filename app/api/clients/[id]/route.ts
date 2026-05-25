import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const FULL_SELECT =
  "id, name, slug, logo_url, is_active, status, onboarding_step, onboarding_completed_at, description, hubspot_owner_id, clay_companies_webhook_url, clay_contacts_webhook_url, clay_find_people_titles, clay_find_people_keywords, clay_excluded_titles, created_at";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .select(FULL_SELECT)
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return NextResponse.json({ client: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.name     !== undefined) updates.name     = body.name.trim();
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url || null;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.slug !== undefined) {
    updates.slug = body.slug
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }
  if (body.description     !== undefined) updates.description     = body.description     || null;
  if (body.hubspot_owner_id !== undefined) updates.hubspot_owner_id = body.hubspot_owner_id || null;
  if (body.status          !== undefined) updates.status          = body.status;
  if (body.onboarding_step !== undefined) updates.onboarding_step = body.onboarding_step;
  if (body.onboarding_completed_at !== undefined)
    updates.onboarding_completed_at = body.onboarding_completed_at;
  if (body.clay_companies_webhook_url !== undefined)
    updates.clay_companies_webhook_url = body.clay_companies_webhook_url || null;
  if (body.clay_contacts_webhook_url !== undefined)
    updates.clay_contacts_webhook_url = body.clay_contacts_webhook_url || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .update(updates)
    .eq("id", params.id)
    .select(FULL_SELECT)
    .single();

  if (error) {
    const msg =
      error.code === "23505"
        ? "Ya existe un cliente con ese slug"
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ client: data });
}
