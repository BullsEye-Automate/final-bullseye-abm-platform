import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("segment_sources")
    .select("*")
    .eq("segment_id", params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { source_type, title, content, url } = body;

  if (!source_type) return NextResponse.json({ error: "Se requiere source_type" }, { status: 400 });

  let finalContent = content ?? null;

  // Si es URL, intentar obtener el contenido
  if (source_type === "url" && url && !finalContent) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BullsEyeBot/1.0)" } });
      const html = await res.text();
      // Extrae texto básico: quita tags HTML, scripts y estilos
      finalContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{3,}/g, "\n")
        .trim()
        .slice(0, 8000); // max 8k chars por fuente
    } catch {
      finalContent = null;
    }
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("segment_sources")
    .insert({
      segment_id: params.id,
      source_type,
      title: title?.trim() ?? null,
      content: finalContent,
      url: url ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ source: data });
}
