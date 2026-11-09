import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { readyClientIds } from "@/lib/centroProspeccion/intel/readiness";
import { planningMonday, runClientIntel } from "@/lib/centroProspeccion/intel/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (viernes, ver vercel.json): Inteligencia de la semana de cada
// cliente listo para el motor (checklist de preparación). Mismo patrón que
// /api/cron/radar-abm-sync: cada cliente corre en su propia invocación
// (?client_id=) y la corrida principal las lanza de a 2. Los clientes que ya
// tienen la inteligencia de la semana se saltan (?all=1 los rehace).

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
    const row = await runClientIntel(one, "cron");
    return NextResponse.json({ client_id: one, ok: row.status !== "error", status: row.status, error: row.error });
  }
  try {
    const all = req.nextUrl.searchParams.get("all") === "1";
    const ids = await readyClientIds();
    const { data: done } = await supabaseAdmin().from("centro_intel").select("client_id").eq("semana", planningMonday()).eq("status", "ok");
    const doneSet = new Set((done ?? []).map((d: { client_id: string }) => d.client_id));
    const queue = ids.filter((id) => all || !doneSet.has(id));
    const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    const results: { client_id: string; ok: boolean; status?: string; error?: string }[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (next < queue.length && Date.now() - startedAt < BUDGET_MS) {
        const id = queue[next++];
        try {
          const url = new URL(self);
          url.searchParams.set("client_id", id);
          const r = await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          results.push({ client_id: id, ok: r.ok && !!j.ok, status: j.status, ...(j.error || !r.ok ? { error: j.error ?? `HTTP ${r.status}` } : {}) });
        } catch (e) {
          results.push({ client_id: id, ok: false, error: (e as Error).message });
        }
      }
    }));
    return NextResponse.json({ semana: planningMonday(), ready: ids.length, skipped: ids.length - queue.length, pending: queue.length - results.length, results });
  } catch (err) {
    console.error("Error en /api/cron/centro-inteligencia:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
