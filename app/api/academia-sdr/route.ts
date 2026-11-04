import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail, resolveClient } from "@/lib/academiaSdr/server/client";
import { getTraining } from "@/lib/academiaSdr/server/source";
import { htmlTitle } from "@/lib/academiaSdr/catalog";

export const dynamic = "force-dynamic";

// Entrenamiento cliente de un cliente (ver lib/academiaSdr/server/source.ts).
//   GET    ?client_id=  → { training: datos del entrenamiento o null si el cliente no tiene }
//   PUT    ?client_id=  → sube o reemplaza el HTML ({ html, sourceUrl? }); manda sobre el del repo
//   DELETE ?client_id=  → quita el HTML subido (vuelve al del repo, si hay)

const MAX_HTML = 4_000_000;

export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const t = await getTraining(db, client, false);
    return NextResponse.json({ training: t?.meta ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const html = typeof body?.html === "string" ? body.html : "";
    if (!html || html.length > MAX_HTML || !/<html|<!doctype|<body|<section/i.test(html)) {
      return NextResponse.json({ error: "El archivo no parece una página HTML (o pesa más de 4 MB)" }, { status: 400 });
    }
    const sourceUrl = typeof body?.sourceUrl === "string" && /^https:\/\/claude\.ai\//.test(body.sourceUrl.trim()) ? body.sourceUrl.trim() : null;
    const now = new Date().toISOString();
    const { error } = await db.from("sdr_academies").upsert(
      { client_id: client.id, html, title: htmlTitle(html), source_url: sourceUrl, uploaded_by: await currentUserEmail(), uploaded_at: now, updated_at: now },
      { onConflict: "client_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const t = await getTraining(db, client, false);
    return NextResponse.json({ training: t?.meta ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const { error } = await db
      .from("sdr_academies")
      .update({ html: null, title: null, source_url: null, uploaded_by: null, uploaded_at: null, updated_at: new Date().toISOString() })
      .eq("client_id", client.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const t = await getTraining(db, client, false);
    return NextResponse.json({ training: t?.meta ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
