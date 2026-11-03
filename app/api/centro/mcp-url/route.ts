import { NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { ensureMcpSecret } from "@/lib/centroProspeccion/mcpSecret";

export const dynamic = "force-dynamic";

// URL del conector MCP para agregarlo en claude.ai (solo administrador).
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo el administrador del Centro" }, { status: 403 });
  try {
    const secret = await ensureMcpSecret();
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
    return NextResponse.json({ url: `${base.replace(/\/$/, "")}/api/centro/mcp/${secret}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
