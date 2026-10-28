import { NextRequest, NextResponse } from "next/server";
import { loadClientIcps } from "@/lib/radarAbm/server/icp";

export const dynamic = "force-dynamic";

// ICP vigente de un cliente para la vista interna de Pulso ABM (requiere sesión, middleware)
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  try {
    return NextResponse.json({ icps: await loadClientIcps(clientId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
