import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { ActiRequestError, createRequest, loadBoard, STAGES } from "@/lib/acti/requests";
import { loadQuota } from "@/lib/acti/quota";

export const dynamic = "force-dynamic";

// GET → tablero de solicitudes (etapas derivadas del flujo real) + cupo
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const db = supabaseAdmin();
  const [items, quota] = await Promise.all([
    loadBoard(db, s.user.clientId),
    loadQuota(db, s.user.clientId, s.member, s.plan, s.config.params),
  ]);
  return NextResponse.json({ items, stages: STAGES, quota });
}

// POST { ref | manual: { name, website }, personas, comment, origin, fit } → "Quiero reunirme con ellos"
export async function POST(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const r = await createRequest(supabaseAdmin(), s, body);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ActiRequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("acti solicitudes:", e);
    return NextResponse.json({ error: "No se pudo registrar la solicitud" }, { status: 500 });
  }
}
