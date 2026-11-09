import { NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { computeReadiness } from "@/lib/centroProspeccion/intel/readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Checklist de preparación de cada cliente para el motor de prospección
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    return NextResponse.json({ clientes: await computeReadiness() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
