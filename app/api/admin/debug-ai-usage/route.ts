import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = supabaseAdmin();

  try {
    // Total overview
    const { data: overview, error: error1 } = await db
      .from("ai_usage_log")
      .select("created_at, cost_usd, input_tokens, output_tokens, model, function_name")
      .order("created_at", { ascending: false });

    if (error1) {
      return NextResponse.json({ error: error1.message }, { status: 500 });
    }

    // Last 30 days
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: last30, error: error30 } = await db
      .from("ai_usage_log")
      .select("*")
      .gte("created_at", since30);

    if (error30) {
      return NextResponse.json({ error: error30.message }, { status: 500 });
    }

    const totalRecords = overview?.length ?? 0;
    const totalCost = overview?.reduce((sum: number, r: any) => sum + Number(r.cost_usd || 0), 0) ?? 0;
    const cost30days = last30?.reduce((sum: number, r: any) => sum + Number(r.cost_usd || 0), 0) ?? 0;

    // Aggregate by model and function
    const models: Record<string, { calls: number; cost: number; input: number; output: number }> = {};
    const functions: Record<string, { calls: number; cost: number }> = {};

    (overview ?? []).forEach((r: any) => {
      const model = r.model || "unknown";
      const fn = r.function_name || "unknown";

      if (!models[model]) models[model] = { calls: 0, cost: 0, input: 0, output: 0 };
      models[model].calls++;
      models[model].cost += Number(r.cost_usd || 0);
      models[model].input += r.input_tokens || 0;
      models[model].output += r.output_tokens || 0;

      if (!functions[fn]) functions[fn] = { calls: 0, cost: 0 };
      functions[fn].calls++;
      functions[fn].cost += Number(r.cost_usd || 0);
    });

    return NextResponse.json({
      summary: {
        total_records: totalRecords,
        total_cost_usd: totalCost.toFixed(2),
        records_last_30_days: last30?.length ?? 0,
        cost_last_30_days: cost30days.toFixed(2),
      },
      models,
      functions,
      recent_records: (overview ?? []).slice(0, 20).map((r: any) => ({
        created_at: r.created_at,
        model: r.model,
        function_name: r.function_name,
        tokens: `${r.input_tokens}/${r.output_tokens}`,
        cost: r.cost_usd,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
