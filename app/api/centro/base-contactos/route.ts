import { NextRequest, NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { getSummary, buildSummary, searchBase } from "@/lib/baseContactos/report";
import { syncChunk } from "@/lib/baseContactos/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Base de contactos (Centro de prospección). Solo el equipo.
// GET = diagnóstico (?fresh=1 lo recalcula) · GET ?q= = buscador.
// POST = sincronizar un tramo ahora (solo la dueña del Centro; ?force=1 = pasada nueva).
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    const q = req.nextUrl.searchParams.get("q");
    if (q != null) return NextResponse.json({ results: await searchBase(q) });
    return NextResponse.json({ summary: await getSummary(req.nextUrl.searchParams.get("fresh") === "1"), canSync: isCentroOwner(u.email) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro" }, { status: 403 });
  try {
    const r = await syncChunk({ budgetMs: 240_000, force: req.nextUrl.searchParams.get("force") === "1" });
    const summary = !r.skipped && r.done ? await buildSummary() : null;
    return NextResponse.json({ skipped: r.skipped, done: "done" in r ? r.done : true, sources: r.state.sources, summary });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
