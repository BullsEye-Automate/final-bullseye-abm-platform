import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { deriveSalesNavRecommendations } from "@/lib/salesNavRecommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cargos objetivo y filtros de Sales Navigator recomendados, derivados del
// ICP del cliente activo (una industria puede tener su propio buyer persona).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();

  const { data: industries } = await db
    .from("icp_industries")
    .select("id, name")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true });

  if (industries?.length) {
    const { data: sections } = await db
      .from("icp_industry_sections")
      .select("industry_id, section_key, content")
      .in("industry_id", industries.map((i) => i.id));

    const sectionsByIndustry = new Map<string, Record<string, string>>();
    for (const s of sections ?? []) {
      if (!sectionsByIndustry.has(s.industry_id)) sectionsByIndustry.set(s.industry_id, {});
      sectionsByIndustry.get(s.industry_id)![s.section_key] = s.content ?? "";
    }

    const result = await Promise.all(
      industries.map(async (ind) => {
        const sec = sectionsByIndustry.get(ind.id) ?? {};
        const recs = await deriveSalesNavRecommendations({
          target_company: sec.target_company ?? "",
          fit_signals: sec.fit_signals ?? "",
          buyer_persona: sec.buyer_persona ?? "",
        });
        return { id: ind.id, name: ind.name, ...recs };
      })
    );

    return NextResponse.json({ industries: result });
  }

  // Modo general (el más común): todos los clientes tienen un único documento
  // ICP en client_ai_context con las mismas secciones etiquetadas — no hace
  // falta tener industrias configuradas para tener cargos decisores/a evitar.
  const { data: icpDoc } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!icpDoc?.content) return NextResponse.json({ industries: [] });

  const recs = await deriveSalesNavRecommendations({
    target_company: icpDoc.content,
    fit_signals: icpDoc.content,
    buyer_persona: icpDoc.content,
  });

  return NextResponse.json({ industries: [{ id: "general", name: "General", ...recs }] });
}
