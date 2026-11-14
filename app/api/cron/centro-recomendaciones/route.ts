import { NextRequest, NextResponse } from "next/server";
import { readyClientIds } from "@/lib/centroProspeccion/intel/readiness";
import { recoDone, runClientRecommendations } from "@/lib/centroProspeccion/intel/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (domingo en la noche de Chile, ver vercel.json): recomendaciones
// IA de empresas de cada cliente listo, en la cantidad que sugiere la
// Inteligencia de la semana (tope 60; sin inteligencia, 20). Quedan en
// Empresas → Recomendadas por IA para que prospección las revise antes de
// proponerlas al cliente.
// Cada corrida trabaja de a 2 clientes en la misma ejecución (sin llamarse por
// HTTP: en Vercel esas invocaciones hijas no terminaban, ver radar-abm-sync) y
// salta los que ya quedaron listos (recoDone); las corridas siguientes, cada
// 20 min, siguen con el resto o completan a los que quedaron cortos.

const START_BUDGET_MS = 40_000; // no empezar un cliente nuevo pasado este tiempo (cada uno usa hasta ~4 min)
const PARALLEL = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const one = req.nextUrl.searchParams.get("client_id");
  if (one) {
    if (!UUID_RE.test(one)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
    const r = await runClientRecommendations(one);
    return NextResponse.json({ ok: !r.estado.startsWith("error"), ...r });
  }
  try {
    const ready = await readyClientIds();
    const done = await Promise.all(ready.map((id) => recoDone(id)));
    const queue = ready.filter((_, i) => !done[i]);
    const results: unknown[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (next < queue.length && Date.now() - startedAt < START_BUDGET_MS) {
        const id = queue[next++];
        try {
          results.push(await runClientRecommendations(id));
        } catch (e) {
          results.push({ client_id: id, estado: `error: ${(e as Error).message}` });
        }
      }
    }));
    return NextResponse.json({ clientes: ready.length, listos: ready.length - queue.length, procesados: results.length, pendientes: queue.length - results.length, results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
