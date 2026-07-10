import { supabaseAdmin } from "@/lib/supabase";

// Precios por millón de tokens (USD) — actualizar si Anthropic cambia tarifas
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":          { input: 3.00,  output: 15.00 },
  "claude-sonnet-5":            { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5-20251001":  { input: 0.80,  output: 4.00  },
  "claude-haiku-4-5":           { input: 0.80,  output: 4.00  },
  "claude-opus-4-8":            { input: 15.00, output: 75.00 },
};

// Multiplicadores sobre el precio de input normal para tokens de prompt caching
// (tarifas de Anthropic para cache de 5 min: escritura 1.25x, lectura 0.1x)
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER  = 0.10;

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number,
  cacheReadInputTokens: number
): number {
  const price = PRICING[model] ?? { input: 3.00, output: 15.00 };
  return (
    (inputTokens               / 1_000_000) * price.input +
    (cacheCreationInputTokens  / 1_000_000) * price.input * CACHE_WRITE_MULTIPLIER +
    (cacheReadInputTokens      / 1_000_000) * price.input * CACHE_READ_MULTIPLIER +
    (outputTokens              / 1_000_000) * price.output
  );
}

export async function logAiUsage({
  clientId,
  functionName,
  model,
  inputTokens,
  outputTokens,
  cacheCreationInputTokens,
  cacheReadInputTokens,
  metadata,
}: {
  clientId?: string | null;
  functionName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const cacheCreation = cacheCreationInputTokens ?? 0;
    const cacheRead     = cacheReadInputTokens      ?? 0;
    const cost_usd = computeCost(model, inputTokens, outputTokens, cacheCreation, cacheRead);
    await supabaseAdmin()
      .from("ai_usage_log")
      .insert({
        client_id:    clientId ?? null,
        function_name: functionName,
        model,
        // input_tokens guarda el total de tokens de entrada procesados (frescos + cache),
        // para que "tokens in" siga reflejando el contexto real usado aunque el costo baje.
        input_tokens:  inputTokens + cacheCreation + cacheRead,
        output_tokens: outputTokens,
        cost_usd,
        metadata:     metadata ?? null,
      });
  } catch (err) {
    // El logging nunca debe romper el flujo principal
    console.warn("[aiUsageLogger] Error al registrar uso:", err);
  }
}
