import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { notInterested } from "@/lib/acti/reco";

export const dynamic = "force-dynamic";

// POST { id, motivo, nota? } → "No me interesa": sale de las recomendaciones
// y de las búsquedas; el motivo queda registrado.
export async function POST(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || typeof body?.motivo !== "string") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const r = await notInterested(supabaseAdmin(), s.user.clientId, body.id, body.motivo, typeof body.nota === "string" ? body.nota : null, {
    email: s.user.email,
    portalUserId: s.user.portalUserId,
  });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
}
