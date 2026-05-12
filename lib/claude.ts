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
