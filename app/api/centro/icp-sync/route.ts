import { NextRequest, NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { syncFichasFromIcp } from "@/lib/centroProspeccion/icpSync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Alinea las fichas del Centro con el ICP de Pulso ABM (lib/centroProspeccion/icpSync.ts).
// GET = vista previa (no escribe). POST = alinear (solo la dueña del Centro).
// ?ficha=<id> = una sola ficha. El cron diario de alertas lo hace solo.
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const rows = await syncFichasFromIcp({ fichaId: req.nextUrl.searchParams.get("ficha") ?? undefined, dryRun: true });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro puede alinear las fichas" }, { status: 403 });
  const rows = await syncFichasFromIcp({ fichaId: req.nextUrl.searchParams.get("ficha") ?? undefined, by: u.email });
  return NextResponse.json({ rows });
}
