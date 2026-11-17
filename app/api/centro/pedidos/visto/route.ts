import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { getFlag, setFlag } from "@/lib/centroProspeccion/intel/automations";

export const dynamic = "force-dynamic";

// Marca un rechazo del cliente como revisado: sale de la lista de pendientes de
// «Pedidos de clientes desde el portal» (Solicitudes del Centro). Sin migración:
// la lista vive en allo_response_cache (clave centro_pedidos_vistos).
const KEY = "centro_pedidos_vistos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const list = (await getFlag<string[]>(KEY)) ?? [];
  if (!list.includes(id)) list.push(id);
  await setFlag(KEY, list.slice(-2000), 120);
  return NextResponse.json({ ok: true });
}
