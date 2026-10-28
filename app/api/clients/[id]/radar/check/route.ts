import { NextRequest, NextResponse } from "next/server";
import { checkClientHubspot } from "@/lib/radarAbm/server/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pulso ABM — prueba el HubSpot del cliente (permisos, propiedades y tamaño
// del universo) sin sincronizar. Requiere sesión interna (middleware).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await checkClientHubspot(params.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
