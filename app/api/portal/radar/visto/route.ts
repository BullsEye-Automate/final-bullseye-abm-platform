import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { recordPortalAccess } from "@/lib/portalAccess";
import { PART_SLUGS } from "@/lib/radarAbm/render";

export const dynamic = "force-dynamic";

// El portal avisa qué vista de Pulso ABM abrió el cliente (lib/portalAccess.ts)
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const b = await req.json().catch(() => ({}));
  const vista = String(b?.vista ?? "");
  await recordPortalAccess(user.portalUserId, PART_SLUGS.includes(vista) ? vista : null);
  return NextResponse.json({ ok: true });
}
