import { NextRequest, NextResponse } from "next/server";
import { syncChunk } from "@/lib/baseContactos/sync";
import { buildSummary } from "@/lib/baseContactos/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (cada hora de noche en Chile, ver vercel.json): un tramo de la
// sincronización de la Base de contactos desde los HubSpot. Cada corrida sigue
// donde quedó la anterior; al terminar la pasada recalcula el diagnóstico. Pasada
// nueva solo los domingos, con lo creado o modificado en la semana. ?force=1 =
// lectura completa.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const r = await syncChunk({ budgetMs: 230_000, force: req.nextUrl.searchParams.get("force") === "1" });
    if (!r.skipped && r.done) await buildSummary();
    return NextResponse.json({ skipped: r.skipped, done: "done" in r ? r.done : true, sources: r.state.sources });
  } catch (e) {
    console.error("[base-contactos]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
