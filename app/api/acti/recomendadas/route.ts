import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { generateRecommendations, listRecommendations } from "@/lib/acti/reco";
import { icpPersonaTargets } from "@/lib/acti/search";
import { loadQuota } from "@/lib/acti/quota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → recomendaciones IA pendientes del socio (motor existente), ordenadas
// por fit → contactos con celular → menor demanda.
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const db = supabaseAdmin();
  const clientId = s.user.clientId;
  const [list, quota, targets] = await Promise.all([
    listRecommendations(db, clientId),
    loadQuota(db, clientId, s.member, s.plan, s.config.params),
    icpPersonaTargets(db, clientId),
  ]);
  return NextResponse.json({ ...list, quota, targets });
}

// POST { action: "generar" } → una tanda más del motor (hasta ~30 empresas
// evaluadas). Solo si aún hay cupo: las recomendaciones van de la mano con
// las empresas necesarias para la meta de reuniones del plan.
export async function POST(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "generar") return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  const db = supabaseAdmin();
  const clientId = s.user.clientId;
  const quota = await loadQuota(db, clientId, s.member, s.plan, s.config.params);
  if (quota.blocked) return NextResponse.json({ error: quota.reason }, { status: 409 });
  const pending = (await listRecommendations(db, clientId)).cards.length;
  if (pending >= Math.max(quota.remaining * 2, 10)) {
    return NextResponse.json({ error: `Ya tienes ${pending} empresas recomendadas por revisar. Elige entre ellas antes de buscar más.` }, { status: 409 });
  }
  try {
    const r = await generateRecommendations(db, clientId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    console.error("acti recomendadas:", e);
    return NextResponse.json({ error: "No se pudieron generar recomendaciones. Intenta de nuevo." }, { status: 500 });
  }
}
