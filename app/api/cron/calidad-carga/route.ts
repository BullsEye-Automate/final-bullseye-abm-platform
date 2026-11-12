import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getCargaReport } from "@/lib/calidadCarga/report";
import { runInBackground } from "@/lib/backgroundTask";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (L-V temprano, ver vercel.json): deja calculada la Calidad de
// carga (últimos 30 días) de cada cliente activo en la Maestra, para que la
// vista "Todos los clientes" abra al instante (caché de 6 h por cliente).
// Cada cliente corre en su propia invocación (?client_id=), de a 2.
const BUDGET_MS = 250_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const one = req.nextUrl.searchParams.get("client_id");
  if (one) {
    if (!UUID_RE.test(one)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
    const task = getCargaReport(one, 30, true).then(
      (r) => ({ ok: true, contacts: r.totals.contacts }),
      (e) => ({ ok: false, error: (e as Error).message }),
    );
    // Responde al instante y calcula en segundo plano (la corrida principal
    // no espera; cortar la conexión ya no termina el cálculo)
    if (runInBackground(task)) return NextResponse.json({ client_id: one, ok: true, accepted: true }, { status: 202 });
    return NextResponse.json({ client_id: one, ...(await task) });
  }
  const startedAt = Date.now();
  const { data: clients } = await supabaseAdmin().from("clients").select("id, name, slug").eq("is_active", true);
  const rows = await readMasterClients().catch(() => null);
  const list = (clients ?? []).filter((c: { id: string; name: string; slug: string | null }) => !rows || findMasterRow(rows, c)?.active);
  const self = new URL(req.nextUrl.pathname, req.nextUrl.origin);
  const launched: string[] = [];
  // De a 2 y esperando la respuesta sin cortar la conexión: cortarla termina
  // la invocación del cliente en Vercel (nov-2026, mismo caso que Pulso ABM)
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < list.length && Date.now() - startedAt < BUDGET_MS) {
      const c = list[next++];
      const url = new URL(self);
      url.searchParams.set("client_id", c.id);
      const wait = Math.max(5_000, 295_000 - (Date.now() - startedAt));
      await fetch(url, { headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}, cache: "no-store", signal: AbortSignal.timeout(wait) }).catch(() => {});
      launched.push(c.name);
    }
  }));
  return NextResponse.json({ launched, pending: list.length - launched.length });
}
