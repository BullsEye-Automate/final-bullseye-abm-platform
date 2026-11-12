import { NextRequest, NextResponse } from "next/server";
import { getReviewerEmail } from "@/lib/portalAdmin";
import { generateKamInsights, loadKamInsights, updateKamConversation } from "@/lib/radarAbm/server/kamInsights";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Pulso ABM → Inteligencia (KAM): insights de feedback y Peitho y temas de
// conversación con el cliente. Solo equipo BullsEye (requiere sesión interna,
// middleware). GET = lo último generado · POST = generar de nuevo ·
// PATCH = estado / nota de una conversación.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  try {
    return NextResponse.json({ doc: await loadKamInsights(clientId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.client_id) return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  try {
    return NextResponse.json({ doc: await generateKamInsights(String(body.client_id), await getReviewerEmail()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.client_id || !body.id) return NextResponse.json({ error: "client_id e id son requeridos" }, { status: 400 });
  try {
    const doc = await updateKamConversation(String(body.client_id), String(body.id), { estado: body.estado, nota: body.nota }, await getReviewerEmail());
    return NextResponse.json({ doc });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
