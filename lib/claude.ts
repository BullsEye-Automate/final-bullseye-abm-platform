import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing. Set it in .env.local");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// Llama a Claude con fallback automático si el modelo principal está sobrecargado.
export async function createMessageWithFallback(
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">
): Promise<{ message: Anthropic.Message; model_used: string }> {
  try {
    const message = await anthropic().messages.create({ ...params, model: CLAUDE_MODEL });
    return { message, model_used: CLAUDE_MODEL };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msgText = (err as Error)?.message ?? "";
    const overloaded = status === 529 || /overloaded/i.test(msgText);
    if (!overloaded) throw err;
    const CLAUDE_FALLBACK_MODEL = process.env.CLAUDE_FALLBACK_MODEL || "claude-haiku-4-5-20251001";
    const fallbackMsg = await anthropic().messages.create({ ...params, model: CLAUDE_FALLBACK_MODEL });
    return { message: fallbackMsg, model_used: CLAUDE_FALLBACK_MODEL };
  }
}
