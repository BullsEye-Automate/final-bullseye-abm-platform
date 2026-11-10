import { NextRequest, NextResponse } from "next/server";
import { readyClientIds } from "@/lib/centroProspeccion/intel/readiness";
import { runClientRecommendations } from "@/lib/centroProspeccion/intel/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (domingo, ver vercel.json): recomendaciones IA de empresas de
// cada cliente listo, en la cantidad que sugiere la Inteligencia de la semana
// (tope 60; sin inteligencia, 20). Quedan en Empresas → Recomendadas por IA
// para que prospección las revise antes de proponerlas al cliente.
// Mismo patrón de /api/cron/radar-abm-sync: una invocación por cliente.

const BUDGET_MS = 270_000;
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
    const queue = await readyClientIds();
    const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    const results: unknown[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (next < queue.length && Date.now() - startedAt < BUDGET_MS) {
        const id = queue[next++];
        try {
          const url = new URL(self);
          url.searchParams.set("client_id", id);
          const r = await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store" });
          results.push(await r.json().catch(() => ({ client_id: id, ok: false, error: `HTTP ${r.status}` })));
        } catch (e) {
          results.push({ client_id: id, ok: false, error: (e as Error).message });
        }
      }
    }));
    return NextResponse.json({ clientes: queue.length, pending: queue.length - results.length, results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
