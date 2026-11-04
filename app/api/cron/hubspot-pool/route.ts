import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSyncState, syncPoolChunk } from "@/lib/hubspotPool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (cada hora de 4 a 9 UTC, ver vercel.json): copia diaria de las
// empresas de HubSpot a hubspot_company_pool (base de la wishlist). Procesa
// tramos hasta agotar el tiempo; la siguiente corrida sigue donde quedó
// (cursor en hubspot_pool_sync_state). Si la pasada del día ya terminó, no
// hace nada. ?force=1 empieza una pasada nueva. Valida CRON_SECRET.

const BUDGET_MS = 240_000;
const FRESH_MS = 18 * 3600_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const db = supabaseAdmin();
  try {
    const state = await getSyncState(db);
    const force = req.nextUrl.searchParams.get("force") === "1";
    if (!force && state.status === "done" && state.finished_at && Date.now() - new Date(state.finished_at).getTime() < FRESH_MS) {
      return NextResponse.json({ skipped: "ya sincronizada hoy", finished_at: state.finished_at, total: state.total_in_pool });
    }
    // Pasada en curso: se continúa; si no (terminada antes o con error), se parte de cero
    let restart = force || state.status !== "running";
    let r = { done: false, synced_count: state.synced_count };
    let chunks = 0;
    while (Date.now() - startedAt < BUDGET_MS) {
      r = await syncPoolChunk(db, restart);
      restart = false;
      chunks++;
      if (r.done) break;
    }
    return NextResponse.json({ ...r, chunks });
  } catch (err) {
    console.error("Error en /api/cron/hubspot-pool:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
