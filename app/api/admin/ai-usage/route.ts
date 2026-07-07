import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const db = supabaseAdmin();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("ai_usage_log")
    .select("*, clients(name)")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupar por función + modelo
  const byFunction: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }> = {};
  const byClient: Record<string, { name: string; calls: number; cost_usd: number }> = {};
  let totalCost = 0;
  let totalCalls = 0;

  for (const row of data ?? []) {
    const fn = row.function_name;
    if (!byFunction[fn]) byFunction[fn] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    byFunction[fn].calls++;
    byFunction[fn].input_tokens  += row.input_tokens;
    byFunction[fn].output_tokens += row.output_tokens;
    byFunction[fn].cost_usd      += Number(row.cost_usd);

    const clientKey = row.client_id ?? "sin_cliente";
    const clientName = (row as any).clients?.name ?? "Sin cliente";
    if (!byClient[clientKey]) byClient[clientKey] = { name: clientName, calls: 0, cost_usd: 0 };
    byClient[clientKey].calls++;
    byClient[clientKey].cost_usd += Number(row.cost_usd);

    totalCost  += Number(row.cost_usd);
    totalCalls += 1;
  }

  return NextResponse.json({
    period_days: days,
    total_calls: totalCalls,
    total_cost_usd: totalCost,
    by_function: byFunction,
    by_client: byClient,
    rows: data,
  });
}
