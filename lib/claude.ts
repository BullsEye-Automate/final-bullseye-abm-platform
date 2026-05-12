import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing. Set it in .env.local");
  }
  // Bumped from SDK default (2) to mitigate transient 529 Overloaded
  // errors from Anthropic. The SDK retries with exponential backoff on
  // 408/409/429/5xx, which covers our case.
  _client = new Anthropic({ apiKey, maxRetries: 5 });
  return _client;
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const CLAUDE_FALLBACK_MODEL =
  process.env.CLAUDE_FALLBACK_MODEL || "claude-haiku-4-5-20251001";

// Llama a Claude con fallback automático a un modelo más pequeño si el
// primario está sobrecargado (529 Overloaded). El cliente ya reintenta
// internamente con backoff; este wrapper se activa solo si después de
// esos 5 intentos sigue saturado. Devuelve qué modelo terminó usándose
// para que la UI pueda mostrar un badge.
export async function createMessageWithFallback(
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">
): Promise<{ message: Anthropic.Message; model_used: string }> {
  try {
    const message = await anthropic().messages.create({ ...params, model: CLAUDE_MODEL });
    return { message, model_used: CLAUDE_MODEL };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const message = (err as Error)?.message ?? "";
    const overloaded = status === 529 || /overloaded/i.test(message);
    if (!overloaded) throw err;
    const fallbackMsg = await anthropic().messages.create({
      ...params,
      model: CLAUDE_FALLBACK_MODEL
    });
    return { message: fallbackMsg, model_used: CLAUDE_FALLBACK_MODEL };
  }
}
