import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tokenToClientId } from "@/lib/form-token";
import {
  deserializeIcpForm,
  serializeSectionForm,
  EMPTY_FORM,
  type IndustrySectionKey,
} from "@/lib/icp-form";

const INDUSTRY_SECTIONS: IndustrySectionKey[] = [
  "target_company",
  "fit_signals",
  "buyer_persona",
  "value_prop",
  "outreach",
  "reference_clients",
];

export const dynamic = "force-dynamic";

// GET — carga el nombre del cliente y el ICP existente (si hay)
// Si se pasa ?industry_id=, carga las secciones de esa industria
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const clientId = tokenToClientId(params.token);
  if (!clientId) {
    return NextResponse.json({ error: "Link inválido o expirado" }, { status: 403 });
  }

  const industryId = req.nextUrl.searchParams.get("industry_id");
  const db = supabaseAdmin();

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();

  if (clientErr || !client) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  // Modo industria: combinar todas las secciones en un texto unificado
  if (industryId) {
    const { data: industry } = await db
      .from("icp_industries")
      .select("id, name")
      .eq("id", industryId)
      .eq("client_id", clientId)
      .single();

    if (!industry) {
      return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
    }

    const { data: rows } = await db
      .from("icp_industry_sections")
      .select("section_key, content")
      .eq("industry_id", industryId);

    // Combinar contenido de todas las secciones en un texto unificado
    const combinedContent = (rows ?? []).map((r: { section_key: string; content: string }) => r.content).filter(Boolean).join("\n\n");

    return NextResponse.json({
      client,
      icp: combinedContent ? { content: combinedContent } : null,
      industry: { id: industry.id, name: industry.name },
    });
  }

  const { data: icp } = await db
    .from("client_ai_context")
    .select("id, content, file_name, uploaded_at")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ client, icp: icp ?? null });
}

// POST — guarda (o actualiza) el ICP del cliente
// Si se pasa industry_id en el body, guarda en las secciones de esa industria
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const clientId = tokenToClientId(params.token);
  if (!clientId) {
    return NextResponse.json({ error: "Link inválido" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: "Contenido vacío" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: client } = await db
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .single();

  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  // Modo industria: guardar cada sección por separado en icp_industry_sections
  if (body.industry_id) {
    const { data: industry } = await db
      .from("icp_industries")
      .select("id")
      .eq("id", body.industry_id)
      .eq("client_id", clientId)
      .single();

    if (!industry) {
      return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
    }

    const form = deserializeIcpForm(body.content);
    const now  = new Date().toISOString();

    const upserts = INDUSTRY_SECTIONS.map((sectionKey) => ({
      industry_id: body.industry_id,
      section_key: sectionKey,
      content:     serializeSectionForm(sectionKey, form),
      copied_from_industry_id: null,
      updated_at:  now,
    }));

    const { error: upsertErr } = await db
      .from("icp_industry_sections")
      .upsert(upserts, { onConflict: "industry_id,section_key" });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // Modo general: actualiza si ya existe, crea si no
  const { data: existing } = await db
    .from("client_ai_context")
    .select("id")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .limit(1)
    .maybeSingle();

  if (existing) {
    await db
      .from("client_ai_context")
      .update({ content: body.content, uploaded_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await db.from("client_ai_context").insert({
      client_id:  clientId,
      file_type:  "icp",
      file_name:  "ICP",
      content:    body.content,
    });
  }

  return NextResponse.json({ ok: true });
}
