import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveClient } from "@/lib/academiaSdr/server/client";
import { getTraining } from "@/lib/academiaSdr/server/source";

export const dynamic = "force-dynamic";

// HTML del Entrenamiento cliente tal cual (la página le agrega el puente de
// avance antes de mostrarlo). ?download=1 lo entrega como archivo.
export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const t = await getTraining(db, client, true);
    if (!t?.html) return NextResponse.json({ error: "Este cliente aún no tiene Entrenamiento cliente" }, { status: 404 });
    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
    if (request.nextUrl.searchParams.get("download") === "1") {
      headers["Content-Disposition"] = `attachment; filename="entrenamiento-${client.slug.replace(/[^a-z0-9-]/gi, "")}.html"`;
    }
    return new NextResponse(t.html, { headers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
