import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tokenToClientId } from "@/lib/form-token";

export const dynamic = "force-dynamic";

// GET — carga el nombre del cliente y el ICP existente (si hay)
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const clientId = tokenToClientId(params.token);
  if (!clientId) {
    return NextResponse.json({ error: "Link inválido o expirado" }, { status: 403 });
  }

  const db = supabaseAdmin();

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();

  if (clientErr || !client) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
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

  // Verifica que el cliente existe
  const { data: client } = await db
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .single();

  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  // Actualiza si ya existe, crea si no
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
