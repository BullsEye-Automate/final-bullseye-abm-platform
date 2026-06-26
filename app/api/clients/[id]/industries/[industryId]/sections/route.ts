import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_SECTIONS = [
  "target_company",
  "fit_signals",
  "buyer_persona",
  "value_prop",
  "outreach",
  "reference_clients",
];

export async function GET(_req: NextRequest, { params }: { params: { id: string; industryId: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("icp_industry_sections")
    .select("section_key, content, copied_from_industry_id, updated_at")
    .eq("industry_id", params.industryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Transformar a mapa section_key → datos
  const sections: Record<string, { content: string; copied_from_industry_id: string | null; updated_at: string }> = {};
  for (const row of data ?? []) {
    sections[row.section_key] = {
      content: row.content,
      copied_from_industry_id: row.copied_from_industry_id,
      updated_at: row.updated_at,
    };
  }

  return NextResponse.json({ sections });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; industryId: string } }) {
  const { section_key, content, copied_from_industry_id } = await req.json().catch(() => ({}));

  if (!VALID_SECTIONS.includes(section_key)) {
    return NextResponse.json({ error: "section_key inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("icp_industry_sections")
    .upsert(
      {
        industry_id: params.industryId,
        section_key,
        content: content ?? "",
        copied_from_industry_id: copied_from_industry_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "industry_id,section_key" }
    )
    .select("section_key, content, copied_from_industry_id, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ section: data });
}
