const LEMLIST_API_BASE = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";

export type LemlistLead = {
  linkedinUrl?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  icebreaker: string;
  emailSubject: string;
  emailBody: string;
  bullseye_fit_score?: number | null;
  bullseye_fit_reason?: string | null;
  bullseye_fit_action?: string | null;
};

type FetchAttempt = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  response_preview: string;
};

export type LemlistPushResult =
  | { ok: true; leadId?: string; status: number; matched_url: string; attempts: FetchAttempt[] }
  | { ok: false; status: number; error: string; debug?: { attempts: FetchAttempt[] } };

function buildAuthHeader(): string {
  const key = process.env.LEMLIST_API_KEY ?? "";
  const token = Buffer.from(`:${key}`).toString("base64");
  return `Basic ${token}`;
}

function buildPayload(lead: LemlistLead): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (lead.linkedinUrl) payload.linkedinUrl = lead.linkedinUrl;
  if (lead.email) payload.email = lead.email;
  if (lead.firstName) payload.firstName = lead.firstName;
  if (lead.lastName) payload.lastName = lead.lastName;
  if (lead.companyName) payload.companyName = lead.companyName;
  if (lead.jobTitle) payload.jobTitle = lead.jobTitle;
  if (lead.phone) payload.phone = lead.phone;
  payload.icebreaker = lead.icebreaker.trim();
  payload.emailSubject = lead.emailSubject.trim();
  payload.emailBody = lead.emailBody.trim();
  if (lead.bullseye_fit_score != null) payload.bullseye_fit_score = lead.bullseye_fit_score;
  if (lead.bullseye_fit_reason) payload.bullseye_fit_reason = lead.bullseye_fit_reason;
  if (lead.bullseye_fit_action) payload.bullseye_fit_action = lead.bullseye_fit_action;
  return payload;
}

const ENRICHMENT_QUERY = "findEmail=true&verifyEmail=true&findPhone=true&linkedinEnrichment=true";

function buildCandidateRequests(campaignId: string, email: string | null | undefined): Array<{ url: string; method: string }> {
  const id = encodeURIComponent(campaignId);
  const requests: Array<{ url: string; method: string }> = [];
  if (email) {
    const enc = encodeURIComponent(email);
    requests.push({ url: `${LEMLIST_API_BASE}/campaigns/${id}/leads/${enc}?verifyEmail=true&findPhone=true`, method: "POST" });
  }
  requests.push({ url: `${LEMLIST_API_BASE}/campaigns/${id}/leads?${ENRICHMENT_QUERY}`, method: "POST" });
  requests.push({ url: `${LEMLIST_API_BASE}/v2/campaigns/${id}/leads?${ENRICHMENT_QUERY}`, method: "POST" });
  return requests;
}

async function tryRequest(url: string, method: string, payload: unknown): Promise<FetchAttempt & { parsed: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: buildAuthHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { url, method, status: 0, ok: false, response_preview: message, parsed: null };
  }
  const rawText = await res.text();
  let parsed: unknown = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch { parsed = { raw: rawText.slice(0, 600) }; }
  return { url, method, status: res.status, ok: res.ok, response_preview: rawText.slice(0, 400), parsed };
}

export async function addLeadToCampaign(campaignId: string, lead: LemlistLead): Promise<LemlistPushResult> {
  if (!process.env.LEMLIST_API_KEY) return { ok: false, status: 500, error: "LEMLIST_API_KEY is not configured" };
  if (!campaignId) return { ok: false, status: 500, error: "campaignId is empty" };
  if (!lead.linkedinUrl && !lead.email) return { ok: false, status: 400, error: "Lead has neither linkedinUrl nor email" };
  const missing = [!lead.icebreaker?.trim() && "icebreaker", !lead.emailSubject?.trim() && "emailSubject", !lead.emailBody?.trim() && "emailBody"].filter(Boolean);
  if (missing.length > 0) return { ok: false, status: 400, error: `Lead has blank ${missing.join(", ")} — refusing to push` };

  const payload = buildPayload(lead);
  const candidates = buildCandidateRequests(campaignId, lead.email);
  const attempts: FetchAttempt[] = [];

  for (const req of candidates) {
    const result = await tryRequest(req.url, req.method, payload);
    attempts.push({ url: result.url, method: result.method, status: result.status, ok: result.ok, response_preview: result.response_preview });
    if (result.ok) {
      const leadId = (result.parsed as { _id?: string; id?: string })?._id ?? (result.parsed as { _id?: string; id?: string })?.id;
      return { ok: true, leadId, status: result.status, matched_url: result.url, attempts };
    }
  }

  const last = attempts[attempts.length - 1];
  return { ok: false, status: last?.status ?? 0, error: `Lemlist rejected the lead on all ${attempts.length} URL pattern(s) tried`, debug: { attempts } };
}
