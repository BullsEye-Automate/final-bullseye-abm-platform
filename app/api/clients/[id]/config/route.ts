import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_configs")
    .select("*")
    .eq("client_id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const payload = {
    client_id:                   params.id,
    lemlist_campaign_id:         body.lemlist_campaign_id         ?? null,
    lemlist_staging_campaign_id: body.lemlist_staging_campaign_id ?? null,
    clay_companies_table_id:     body.clay_companies_table_id     ?? null,
    clay_contacts_table_id:      body.clay_contacts_table_id      ?? null,
    hubspot_owner_id:            body.hubspot_owner_id            ?? null,
  };

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("client_configs")
    .upsert(payload, { onConflict: "client_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
