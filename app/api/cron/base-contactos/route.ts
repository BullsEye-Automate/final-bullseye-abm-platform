import { NextRequest, NextResponse } from "next/server";
import { syncChunk } from "@/lib/baseContactos/sync";
import { buildSummary } from "@/lib/baseContactos/report";
import { qualityChunk } from "@/lib/baseContactos/quality";

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
    const deadline = Date.now() + 240_000;
    const r = await syncChunk({ budgetMs: 200_000, force: req.nextUrl.searchParams.get("force") === "1" });
    const syncDone = r.skipped || ("done" in r && r.done);
    // Calidad de celulares y correos (Allo, rebotes, «ya no trabaja»): cuando la lectura de HubSpot terminó
    const q = syncDone ? await qualityChunk({ deadline }).catch((e) => ({ skipped: true, reason: (e as Error).message })) : { skipped: true, reason: "Lectura de HubSpot en curso" };
    if ((!r.skipped && "done" in r && r.done) || (!q.skipped && "done" in q && q.done)) await buildSummary();
    return NextResponse.json({ skipped: r.skipped, done: "done" in r ? r.done : true, sources: r.state.sources, quality: q });
  } catch (e) {
    console.error("[base-contactos]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
