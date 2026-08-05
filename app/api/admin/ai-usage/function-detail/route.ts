import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const functionName = req.nextUrl.searchParams.get("function") ?? "message_generation_sequence";
  const db = supabaseAdmin();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("ai_usage_log")
    .select("*, clients(name)")
    .eq("function_name", functionName)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Análisis detallado
  let totalCost = 0;
  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const byClient: Record<string, { name: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }> = {};
  const byDay: Record<string, { calls: number; cost_usd: number }> = {};
  const byModel: Record<string, { calls: number; cost_usd: number; input_tokens: number; output_tokens: number }> = {};

  // Métricas de metadata
  const metadataStats = {
    total_contacts: 0,
    total_companies: 0,
    total_sequences: 0,
    avg_tokens_per_contact: 0,
    avg_cost_per_contact: 0,
  };

  const allMetadata: Array<{ contacts?: number; companies?: number; sequences?: number; cost: number; tokens: number }> = [];

  for (const row of data ?? []) {
    totalCost += Number(row.cost_usd);
    totalCalls += 1;
    totalInputTokens += row.input_tokens;
    totalOutputTokens += row.output_tokens;

    // Por cliente
    const clientKey = row.client_id ?? "sin_cliente";
    const clientName = (row as any).clients?.name ?? "Sin cliente";
    if (!byClient[clientKey]) {
      byClient[clientKey] = { name: clientName, calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    }
    byClient[clientKey].calls++;
    byClient[clientKey].cost_usd += Number(row.cost_usd);
    byClient[clientKey].input_tokens += row.input_tokens;
    byClient[clientKey].output_tokens += row.output_tokens;

    // Por día
    const date = new Date(row.created_at).toISOString().split("T")[0];
    if (!byDay[date]) byDay[date] = { calls: 0, cost_usd: 0 };
    byDay[date].calls++;
    byDay[date].cost_usd += Number(row.cost_usd);

    // Por modelo
    const model = row.model;
    if (!byModel[model]) {
      byModel[model] = { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    }
    byModel[model].calls++;
    byModel[model].cost_usd += Number(row.cost_usd);
    byModel[model].input_tokens += row.input_tokens;
    byModel[model].output_tokens += row.output_tokens;

    // Metadata
    if (row.metadata) {
      const meta = row.metadata as any;
      allMetadata.push({
        contacts: meta.num_contacts || meta.contacts_count || 0,
        companies: meta.num_companies || meta.companies_count || 0,
        sequences: meta.num_sequences || meta.sequences_count || 1,
        cost: Number(row.cost_usd),
        tokens: row.input_tokens + row.output_tokens,
      });

      if (meta.num_contacts) metadataStats.total_contacts += meta.num_contacts;
      if (meta.contacts_count) metadataStats.total_contacts += meta.contacts_count;
      if (meta.num_companies) metadataStats.total_companies += meta.num_companies;
      if (meta.companies_count) metadataStats.total_companies += meta.companies_count;
      if (meta.num_sequences) metadataStats.total_sequences += meta.num_sequences;
    }
  }

  // Calcular promedios
  if (allMetadata.length > 0) {
    metadataStats.avg_tokens_per_contact = metadataStats.total_contacts > 0
      ? (totalInputTokens + totalOutputTokens) / metadataStats.total_contacts
      : 0;
    metadataStats.avg_cost_per_contact = metadataStats.total_contacts > 0
      ? totalCost / metadataStats.total_contacts
      : 0;
  }

  return NextResponse.json({
    function_name: functionName,
    period_days: days,
    total_calls: totalCalls,
    total_cost_usd: totalCost,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    by_client: byClient,
    by_day: byDay,
    by_model: byModel,
    metadata_stats: metadataStats,
    all_metadata: allMetadata,
    raw_rows: data,
  });
}
