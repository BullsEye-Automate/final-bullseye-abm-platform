import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { getClientIcpText } from "@/lib/wishlist";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// ICP vigente del portal (Sistema → ICP) para la ficha de un cliente del
// Centro de prospección. Solo lectura: el ICP se edita en el portal.
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const fichaId = req.nextUrl.searchParams.get("clienteId") ?? "";
  if (!fichaId || fichaId.length > 200) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 });
  try {
    const links = await loadClientLinks();
    const client = links.byFicha.get(fichaId);
    if (!client) return NextResponse.json({ linked: false });
    const icp = await getClientIcpText(supabaseAdmin(), client.id);
    return NextResponse.json({ linked: true, client: { name: client.name, slug: client.slug }, icp });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
