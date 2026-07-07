import { supabaseAdmin } from "@/lib/supabase";

// Precios por millón de tokens (USD) — actualizar si Anthropic cambia tarifas
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":          { input: 3.00,  output: 15.00 },
  "claude-sonnet-5":            { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5-20251001":  { input: 0.80,  output: 4.00  },
  "claude-haiku-4-5":           { input: 0.80,  output: 4.00  },
  "claude-opus-4-8":            { input: 15.00, output: 75.00 },
};

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? { input: 3.00, output: 15.00 };
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export async function logAiUsage({
  clientId,
  functionName,
  model,
  inputTokens,
  outputTokens,
  metadata,
}: {
  clientId?: string | null;
  functionName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const cost_usd = computeCost(model, inputTokens, outputTokens);
    await supabaseAdmin()
      .from("ai_usage_log")
      .insert({
        client_id:    clientId ?? null,
        function_name: functionName,
        model,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        cost_usd,
        metadata:     metadata ?? null,
      });
  } catch (err) {
    // El logging nunca debe romper el flujo principal
    console.warn("[aiUsageLogger] Error al registrar uso:", err);
  }
}
