import { NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { runProspectingLists } from "@/lib/listasHubspot";
import { chileDay } from "@/lib/feriados/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Listas de contactos prospectados en HubSpot (lib/listasHubspot.ts), con sesión:
//   GET  = vista previa (qué contactos entrarían en la próxima corrida; no escribe nada)
//   POST = correr ahora (solo la líder del Centro): crea las listas y envía el correo
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    return NextResponse.json(await runProspectingLists({ day: chileDay(), dryRun: true }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro puede correrlo a mano" }, { status: 403 });
  try {
    return NextResponse.json(await runProspectingLists({ day: chileDay() }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
