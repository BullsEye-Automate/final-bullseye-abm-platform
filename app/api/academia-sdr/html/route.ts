import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadAcademy } from "@/lib/academiaSdr/server/generate";
import { resolveClient } from "@/lib/academiaSdr/server/client";
import { renderAcademyHtml } from "@/lib/academiaSdr/render";
import type { AcademyModule } from "@/lib/academiaSdr/types";

export const dynamic = "force-dynamic";

// Descarga la Academia SDR del cliente como un .html autocontenido.
export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const academy = await loadAcademy(db, client.id);
    const modules = academy.modules.filter((m): m is AcademyModule => m !== null);
    if (!modules.length) return NextResponse.json({ error: "La academia aún no está generada" }, { status: 404 });
    const html = renderAcademyHtml({ clientName: client.name, clientKey: client.slug, modules });
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="academia-sdr-${client.slug.replace(/[^a-z0-9-]/gi, "")}.html"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
