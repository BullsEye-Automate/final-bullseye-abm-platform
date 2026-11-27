import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { getClientReceptivos, listCachedSummaries, saveDecision } from "@/lib/receptivos/suggest";
import { loadReceptive } from "@/lib/receptivos/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Contactos receptivos (Centro de prospección). Solo el equipo.
// GET ?client_id=  → estadísticas + sugerencias del cliente (?fresh=1 recalcula)
// GET sin cliente  → resumen de los clientes ya calculados esta semana
// POST { client_id, key, action: "cargar" | "descartar", motivo? }
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const clientId = req.nextUrl.searchParams.get("client_id");
  try {
    if (!clientId || clientId === "__all__") return NextResponse.json({ summaries: await listCachedSummaries() });
    return NextResponse.json(await getClientReceptivos(clientId, req.nextUrl.searchParams.get("fresh") === "1"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const b = (await req.json().catch(() => ({}))) as { client_id?: string; key?: string; action?: string; motivo?: string };
  if (!b.client_id || !b.key) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  if (b.action === "descartar") {
    await saveDecision(b.client_id, b.key, { st: "descartado", by: u.email, at: new Date().toISOString(), motivo: (b.motivo ?? "").slice(0, 300) || null });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "cargar") {
    const r = await loadReceptive(b.client_id, b.key, u.email);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}
