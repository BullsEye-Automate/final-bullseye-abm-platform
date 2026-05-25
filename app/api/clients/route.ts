import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .select("id, name, slug, logo_url, is_active, status, onboarding_step, created_at")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  }

  const name: string = body.name.trim();
  const slug: string = (body.slug ?? name)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  if (!slug) {
    return NextResponse.json({ error: "El slug no puede quedar vacío" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clients")
    .insert({
      name,
      slug,
      logo_url:        body.logo_url        ?? null,
      description:     body.description     ?? null,
      hubspot_owner_id: body.hubspot_owner_id ?? null,
      status:          body.status          ?? "active",
      onboarding_step: body.onboarding_step ?? 0,
    })
    .select("id, name, slug, logo_url, is_active, status, onboarding_step, description, hubspot_owner_id, clay_companies_webhook_url, clay_contacts_webhook_url, clay_scoring_prompt, created_at")
    .single();

  if (error) {
    const msg = error.code === "23505"
      ? "Ya existe un cliente con ese slug"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ client: data }, { status: 201 });
}
