import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runDeepResearch } from "@/lib/deep-research";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies")
    .select("id, company_name, company_website, company_linkedin_url, company_country, client_id")
    .eq("id", params.id)
    .maybeSingle();

  if (compErr || !company) {
    return NextResponse.json(
      { error: compErr?.message ?? "Empresa no encontrada" },
      { status: 404 }
    );
  }

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", company.client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!icpCtx?.content?.trim()) {
    return NextResponse.json(
      { error: "El cliente no tiene ICP configurado" },
      { status: 400 }
    );
  }

  try {
    const result = await runDeepResearch({
      companyName:     company.company_name,
      companyWebsite:  company.company_website,
      companyLinkedin: company.company_linkedin_url,
      companyCountry:  company.company_country,
      icpContent:      icpCtx.content
    });

    const { error: updateErr } = await db
      .from("companies")
      .update({ deep_research: JSON.stringify(result) })
      .eq("id", params.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error en deep research";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
