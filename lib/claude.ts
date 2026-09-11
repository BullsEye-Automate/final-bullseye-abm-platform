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
export const HAIKU_MODEL  = process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";

/** Devuelve el modelo configurado para el cliente, o el default global si no tiene uno asignado. */
export async function getClientModel(db: any, clientId: string): Promise<string> {
  try {
    const { data } = await db
      .from("client_configs")
      .select("claude_model")
      .eq("client_id", clientId)
      .maybeSingle();
    return data?.claude_model ?? CLAUDE_MODEL;
  } catch {
    return CLAUDE_MODEL;
  }
}
