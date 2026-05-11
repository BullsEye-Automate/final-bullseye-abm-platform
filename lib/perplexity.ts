const PERPLEXITY_API = "https://api.perplexity.ai/chat/completions";

export type PerplexityCitation = { title: string; url: string };
export type PerplexityResponse = {
  content: string;
  citations: PerplexityCitation[];
};

export async function perplexitySearch(opts: {
  system: string;
  user: string;
  searchRecencyFilter?: "day" | "week" | "month" | "year";
}): Promise<PerplexityResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY missing. Set it in .env.local");
  }
  const model = process.env.PERPLEXITY_MODEL || "sonar-pro";

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user }
    ],
    return_citations: true,
    temperature: 0.2
  };
  if (opts.searchRecencyFilter) {
    body.search_recency_filter = opts.searchRecencyFilter;
  }

  const res = await fetch(PERPLEXITY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity API ${res.status}: ${text}`);
  }

  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";

  // Perplexity has been returning citations in either `citations` (array of URLs)
  // or `search_results` (array of {title, url}). Normalize both.
  let citations: PerplexityCitation[] = [];
  if (Array.isArray(json?.search_results)) {
    citations = json.search_results
      .filter((s: any) => s?.url)
      .map((s: any) => ({ title: s.title ?? s.url, url: s.url }));
  } else if (Array.isArray(json?.citations)) {
    citations = json.citations
      .filter((c: any) => typeof c === "string" || c?.url)
      .map((c: any) => (typeof c === "string" ? { title: c, url: c } : { title: c.title ?? c.url, url: c.url }));
  }

  return { content, citations };
}
