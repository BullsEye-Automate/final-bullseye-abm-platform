import { NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portalAuth";
import { clientFeedbackToken } from "@/lib/radarAbm/server/icp";

export const dynamic = "force-dynamic";

// Token del link de feedback de reuniones del cliente de la sesión: el
// portal muestra el mismo formulario de /feedback-cliente/<token> embebido.
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  return NextResponse.json({ token: await clientFeedbackToken(user.clientId) });
}
