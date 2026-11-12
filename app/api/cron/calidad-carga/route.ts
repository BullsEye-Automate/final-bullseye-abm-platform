import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getCargaReport } from "@/lib/calidadCarga/report";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (L-V temprano, ver vercel.json): deja calculada la Calidad de
// carga (últimos 30 días) de cada cliente activo en la Maestra, para que la
// vista "Todos los clientes" abra al instante (caché de 6 h por cliente).
// Calcula de a 2 clientes en la misma ejecución; ?client_id= uno solo a mano.
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
    try {
      const r = await getCargaReport(one, 30, true);
      return NextResponse.json({ client_id: one, ok: true, contacts: r.totals.contacts });
    } catch (e) {
      return NextResponse.json({ client_id: one, ok: false, error: (e as Error).message });
    }
  }
  const startedAt = Date.now();
  const { data: clients } = await supabaseAdmin().from("clients").select("id, name, slug").eq("is_active", true);
  const rows = await readMasterClients().catch(() => null);
  const list = (clients ?? []).filter((c: { id: string; name: string; slug: string | null }) => !rows || findMasterRow(rows, c)?.active);
  const launched: string[] = [];
  // De a 2 en esta misma ejecución (nov-2026: las invocaciones lanzadas por
  // fetch no terminaban, mismo caso que Pulso ABM). Lo que no alcance queda
  // sin caché y se calcula al abrirlo.
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < list.length && Date.now() - startedAt < BUDGET_MS) {
      const c = list[next++];
      await getCargaReport(c.id, 30, true).catch(() => null);
      launched.push(c.name);
    }
  }));
  return NextResponse.json({ launched, pending: list.length - launched.length });
}
