import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    client_id, company_name, fit_score, fit_signals, fit_reason,
    research_summary, company_type, company_size, company_country,
    company_city, linkedin_url, website,
  } = body;

  if (!client_id)    return NextResponse.json({ error: "client_id requerido" }, { status: 400 });
  if (!company_name) return NextResponse.json({ error: "company_name requerido" }, { status: 400 });

  const db = supabaseAdmin();

  // Evitar duplicados por nombre dentro del mismo cliente
  const { data: existing } = await db
    .from("companies")
    .select("id, status")
    .eq("client_id", client_id)
    .ilike("company_name", company_name.trim())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ company_id: existing.id, already_exists: true, status: existing.status });
  }

  const summary = [fit_reason, research_summary].filter(Boolean).join("\n\n") || null;

  const { data, error } = await db
    .from("companies")
    .insert({
      client_id,
      company_name:        company_name.trim(),
      company_linkedin_url: linkedin_url   ?? null,
      company_website:     website         ?? null,
      company_type:        company_type    ?? null,
      company_size:        company_size    ?? null,
      company_country:     company_country ?? null,
      company_city:        company_city    ?? null,
      fit_signals:         fit_signals     ?? null,
      fit_score:           fit_score       ?? null,
      research_summary:    summary,
      status:              "pending",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ company_id: data.id, already_exists: false });
}
