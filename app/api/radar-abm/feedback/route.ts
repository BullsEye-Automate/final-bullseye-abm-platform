import { NextRequest, NextResponse } from "next/server";
import { clientFeedbackToken } from "@/lib/radarAbm/server/icp";

export const dynamic = "force-dynamic";

// Link de feedback de un cliente para la vista interna de Pulso ABM (requiere sesión, middleware)
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  return NextResponse.json({ token: await clientFeedbackToken(clientId) });
}
