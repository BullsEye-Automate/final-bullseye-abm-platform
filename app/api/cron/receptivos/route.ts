import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache } from "@/lib/celulasSdr/cache";
import { findMasterRow, readMasterClients } from "@/lib/radarAbm/server/masterClients";
import { getClientReceptivos } from "@/lib/receptivos/suggest";
import { getReceptive } from "@/lib/receptivos/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (cada 30 min, ver vercel.json; salta los clientes ya calculados esta semana): deja calculados los contactos
// receptivos de cada cliente activo en la Maestra para la semana. Cada corrida
// sigue con los que faltan (de a uno, hasta ~4 min). ?client_id= uno solo.
const weekKey = () => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deadline = Date.now() + 230_000;
  const only = req.nextUrl.searchParams.get("client_id");
  const { data } = await supabaseAdmin().from("clients").select("id, name, slug");
  const master = await readMasterClients(true).catch(() => []);
  const clients = ((data ?? []) as { id: string; name: string; slug: string | null }[])
    .filter((c) => (only ? c.id === only : findMasterRow(master, c)?.active));
  await getReceptive(); // base del día una sola vez
  const done: string[] = [], errors: string[] = [];
  for (const c of clients) {
    if (Date.now() > deadline) break;
    if (!only && (await readMonthCache(`receptivos:cli:v2:${c.id}:${weekKey()}`))) continue;
    try { await getClientReceptivos(c.id, !!only); done.push(c.name); } catch (e) { errors.push(`${c.name}: ${(e as Error).message.slice(0, 120)}`); }
  }
  return NextResponse.json({ done, errors });
}
