import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./claude";
import { PREFILTER_SYSTEM, prefilterUserPrompt } from "./contactsPrompts";

export type PrefilterInput = {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
};

export type PrefilterResult = "yes" | "no";

export async function runPrefilter(input: PrefilterInput): Promise<PrefilterResult> {
  const message = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8,
    temperature: 0,
    system: [{ type: "text", text: PREFILTER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prefilterUserPrompt(input) }]
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text.trim().toUpperCase())
    .join(" ");

  return text.startsWith("YES") ? "yes" : "no";
}
