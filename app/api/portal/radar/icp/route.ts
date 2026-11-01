import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { loadClientIcps } from "@/lib/radarAbm/server/icp";

export const dynamic = "force-dynamic";

// ICP vigente del cliente de la sesión (Pulso ABM → ICP del proyecto)
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  try {
    return NextResponse.json({ icps: await loadClientIcps(user.clientId) });
  } catch (err) {
    console.error("Pulso ABM (portal): ICP", err);
    return NextResponse.json({ error: "No se pudo cargar el ICP" }, { status: 500 });
  }
}
