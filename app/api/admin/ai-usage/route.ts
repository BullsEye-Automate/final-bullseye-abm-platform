import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = supabaseAdmin();

  let since: string;
  let now: string;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");

  if (fromParam && toParam) {
    since = new Date(fromParam).toISOString();
    now = new Date(toParam).toISOString();
  } else {
    const days = Number(req.nextUrl.searchParams.get("days") ?? "7");
    const cutoffMs = days * 24 * 60 * 60 * 1000;
    since = new Date(Date.now() - cutoffMs).toISOString();
    now = new Date().toISOString();
  }

  // Obtener datos de usuarios para mapear IDs a emails
  const { data: users, error: usersError } = await db
    .from("auth.users")
    .select("id, email");

  const userMap: Record<string, string> = {};
  if (users) {
    for (const user of users) {
      userMap[user.id] = user.email || "Usuario desconocido";
    }
  }

  const { data, error } = await db
    .from("ai_usage_log")
    .select("*, clients(name)")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupar por función, cliente, modelo, usuario y día
  const byFunction: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }> = {};
  const byClient: Record<string, { name: string; calls: number; cost_usd: number }> = {};
  const byModel: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }> = {};
  const byUser: Record<string, { email: string; calls: number; cost_usd: number }> = {};
  const byDay: Record<string, { calls: number; cost_usd: number }> = {};
  const functionsByDay: Record<string, Record<string, { calls: number; cost_usd: number }>> = {};

  let totalCost = 0;
  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const row of data ?? []) {
    const fn = row.function_name;
    const model = row.model;
    const date = new Date(row.created_at).toISOString().split("T")[0];

    // Por función
    if (!byFunction[fn]) byFunction[fn] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    byFunction[fn].calls++;
    byFunction[fn].input_tokens  += row.input_tokens;
    byFunction[fn].output_tokens += row.output_tokens;
    byFunction[fn].cost_usd      += Number(row.cost_usd);

    // Por modelo
    if (!byModel[model]) byModel[model] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    byModel[model].calls++;
    byModel[model].input_tokens  += row.input_tokens;
    byModel[model].output_tokens += row.output_tokens;
    byModel[model].cost_usd      += Number(row.cost_usd);

    // Por cliente
    const clientKey = row.client_id ?? "sin_cliente";
    const clientName = (row as any).clients?.name ?? "Sin cliente";
    if (!byClient[clientKey]) byClient[clientKey] = { name: clientName, calls: 0, cost_usd: 0 };
    byClient[clientKey].calls++;
    byClient[clientKey].cost_usd += Number(row.cost_usd);

    // Por usuario
    if (row.user_id) {
      const userKey = row.user_id;
      const userEmail = userMap[userKey] ?? "Usuario desconocido";
      if (!byUser[userKey]) byUser[userKey] = { email: userEmail, calls: 0, cost_usd: 0 };
      byUser[userKey].calls++;
      byUser[userKey].cost_usd += Number(row.cost_usd);
    }

    // Por día
    if (!byDay[date]) byDay[date] = { calls: 0, cost_usd: 0 };
    byDay[date].calls++;
    byDay[date].cost_usd += Number(row.cost_usd);

    // Funciones por día
    if (!functionsByDay[date]) functionsByDay[date] = {};
    if (!functionsByDay[date][fn]) functionsByDay[date][fn] = { calls: 0, cost_usd: 0 };
    functionsByDay[date][fn].calls++;
    functionsByDay[date][fn].cost_usd += Number(row.cost_usd);

    totalCost  += Number(row.cost_usd);
    totalCalls += 1;
    totalInputTokens  += row.input_tokens;
    totalOutputTokens += row.output_tokens;
  }

  // Top 10 funciones más costosas
  const topFunctions = Object.entries(byFunction)
    .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
    .slice(0, 10);

  // Top 10 funciones más frecuentes
  const topFrequent = Object.entries(byFunction)
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 10);

  const dateRange = data && data.length > 0
    ? { oldest: data[data.length - 1].created_at, newest: data[0].created_at }
    : null;

  return NextResponse.json({
    period_days: days,
    query_since: since,
    query_now: now,
    data_date_range: dateRange,
    total_calls: totalCalls,
    total_cost_usd: totalCost,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    by_function: byFunction,
    by_client: byClient,
    by_model: byModel,
    by_user: byUser,
    by_day: byDay,
    functions_by_day: functionsByDay,
    top_functions_by_cost: topFunctions,
    top_functions_by_calls: topFrequent,
  });
}
