import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { refreshKamInsightsIfChanged } from "@/lib/radarAbm/server/kamInsights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (L-V, ver vercel.json): Pulso ABM → Inteligencia (KAM).
// Por cada cliente activo en la Maestra revisa si hay feedback o reuniones de
// Peitho nuevas desde la última versión de los insights y, solo entonces, los
// regenera con IA (sin cambios = sin costo). De a 2 clientes en la misma
// ejecución; lo que no alcance lo toma la corrida siguiente (sigue con la
// huella distinta). ?client_id= uno solo a mano.
const BUDGET_MS = 240_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const one = req.nextUrl.searchParams.get("client_id");
  if (one) {
    if (!UUID_RE.test(one)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
    try {
      return NextResponse.json({ client_id: one, result: await refreshKamInsightsIfChanged(one) });
    } catch (e) {
      return NextResponse.json({ client_id: one, error: (e as Error).message }, { status: 500 });
    }
  }
  const startedAt = Date.now();
  const { data: clients } = await supabaseAdmin().from("clients").select("id, name, slug").eq("is_active", true);
  const rows = await readMasterClients().catch(() => null);
  const list = (clients ?? []).filter((c: { id: string; name: string; slug: string | null }) => !rows || findMasterRow(rows, c)?.active);
  const results: Record<string, string> = {};
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < list.length && Date.now() - startedAt < BUDGET_MS) {
      const c = list[next++];
      results[c.name] = await refreshKamInsightsIfChanged(c.id).catch((e) => `error: ${(e as Error).message}`);
    }
  }));
  return NextResponse.json({ results, pending: list.length - Object.keys(results).length });
}
