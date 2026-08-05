import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = supabaseAdmin();

  // Total overview
  const { data: overview, error: error1 } = await db
    .from("ai_usage_log")
    .select("created_at, cost_usd, input_tokens, output_tokens, model, function_name", { count: "exact" })
    .order("created_at", { ascending: false });

  // By function
  const { data: byFn } = await db.rpc("ai_usage_by_function") as any;

  // By model
  const { data: byModel } = await db.rpc("ai_usage_by_model") as any;

  // Last 30 days
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: last30 } = await db
    .from("ai_usage_log")
    .select("*", { count: "exact" })
    .gte("created_at", since30);

  const totalRecords = overview?.length ?? 0;
  const totalCost = overview?.reduce((sum: number, r: any) => sum + Number(r.cost_usd || 0), 0) ?? 0;
  const cost30days = last30?.reduce((sum: number, r: any) => sum + Number(r.cost_usd || 0), 0) ?? 0;

  return NextResponse.json({
    summary: {
      total_records: totalRecords,
      total_cost_usd: totalCost.toFixed(2),
      records_last_30_days: last30?.length ?? 0,
      cost_last_30_days: cost30days.toFixed(2),
    },
    models: (overview ?? []).reduce((acc: Record<string, { calls: number; cost: number; input: number; output: number }>, r: any) => {
      const k = r.model;
      if (!acc[k]) acc[k] = { calls: 0, cost: 0, input: 0, output: 0 };
      acc[k].calls++;
      acc[k].cost += Number(r.cost_usd || 0);
      acc[k].input += r.input_tokens || 0;
      acc[k].output += r.output_tokens || 0;
      return acc;
    }, {}),
    functions: (overview ?? []).reduce((acc: Record<string, { calls: number; cost: number }>, r: any) => {
      const k = r.function_name;
      if (!acc[k]) acc[k] = { calls: 0, cost: 0 };
      acc[k].calls++;
      acc[k].cost += Number(r.cost_usd || 0);
      return acc;
    }, {}),
    recent_records: (overview ?? []).slice(0, 20).map((r: any) => ({
      created_at: r.created_at,
      model: r.model,
      function_name: r.function_name,
      tokens: `${r.input_tokens}/${r.output_tokens}`,
      cost: r.cost_usd,
    })),
  });
}
