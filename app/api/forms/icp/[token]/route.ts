import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tokenToClientId } from "@/lib/form-token";
import { getClientIndustry, saveIcpContent } from "@/lib/icpStore";

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

  // Modo industria: valida que la industria sea del cliente antes de guardar
  if (body.industry_id && !(await getClientIndustry(db, clientId, body.industry_id))) {
    return NextResponse.json({ error: "Industria no encontrada" }, { status: 404 });
  }

  const { error: saveErr } = await saveIcpContent(db, clientId, body.industry_id ?? null, body.content);
  if (saveErr) return NextResponse.json({ error: saveErr }, { status: 500 });

  return NextResponse.json({ ok: true });
}
