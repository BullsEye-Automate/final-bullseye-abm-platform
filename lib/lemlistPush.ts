import type { SupabaseClient } from "@supabase/supabase-js";
import { addLeadToCampaign } from "./lemlist";
import { generateMessages, type MessageInput } from "./messageGenerator";
import { computeContactFitScore, type ScoreInput } from "./contactScoring";
import { getClientLemlistCampaignId } from "./lemlistCampaigns";
import { loadClientIcpContext, loadActiveModelTrainingConfig } from "./modelTrainingConfig";

export type LemlistPushOk = { ok: true; lead_id?: string; messages_generated: boolean; model_used?: string };
export type LemlistPushErr = { ok: false; error: string; status?: number; debug?: unknown };
export type LemlistPushResult = LemlistPushOk | LemlistPushErr;

export type LemlistPushContact = {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  seniority: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
};

export type LemlistPushCompany = {
  company_name: string | null;
  company_size: number | null;
  company_type: string | null;
  tool_primary: string | null;
  tool_secondary: string | null;
  fit_signals: string | null;
} | null;

export async function pushApprovedToLemlist(
  db: SupabaseClient,
  contactId: string,
  contact: LemlistPushContact,
  company: LemlistPushCompany,
  options?: { force_regenerate?: boolean; clientId?: string | null }
): Promise<LemlistPushResult> {
  if (options?.force_regenerate) {
    contact = { ...contact, linkedin_icebreaker: null, email_subject: null, email_body: null };
  }

  // Fallback fit_score si es null (importado por Sales Nav, web scrape, manual)
  if (contact.fit_score == null && company) {
    try {
      const scoreInput: ScoreInput = {
        first_name: contact.first_name, last_name: contact.last_name, job_title: contact.job_title,
        linkedin_headline: contact.linkedin_headline, seniority: contact.seniority,
        company_name: company.company_name, company_type: company.company_type,
        company_size: company.company_size, tool_primary: company.tool_primary,
        tool_secondary: company.tool_secondary, fit_signals: company.fit_signals
      };
      const scored = await computeContactFitScore(scoreInput);
      const patch: Record<string, unknown> = { fit_score: scored.fit_score, fit_reason: scored.fit_reason, fit: scored.fit };
      await db.from("contacts").update(patch).eq("id", contactId);
      contact = { ...contact, fit_score: scored.fit_score, fit_reason: scored.fit_reason };
    } catch { /* ignorar errores de scoring */ }
  }

  // Resolver campaña multi-tenant
  let clientId = options?.clientId ?? null;
  if (!clientId) {
    const { data: contactRow } = await db.from("contacts").select("client_id").eq("id", contactId).maybeSingle();
    clientId = (contactRow as any)?.client_id ?? null;
  }
  const campaignId = await getClientLemlistCampaignId(db, clientId);
  if (!campaignId) {
    const error = "LEMLIST_CAMPAIGN_ID is not configured";
    await db.from("contacts").update({ lemlist_push_error: error }).eq("id", contactId);
    return { ok: false, error };
  }

  const blank = (s: string | null | undefined): boolean => !s || !s.trim();
  let icebreaker = contact.linkedin_icebreaker;
  let subject = contact.email_subject;
  let emailBody = contact.email_body;
  let messages_generated = false;
  let model_used: string | undefined;

  if (blank(icebreaker) || blank(subject) || blank(emailBody)) {
    if (!company) {
      const error = "Cannot generate messages: contact has no company joined";
      await db.from("contacts").update({ lemlist_push_error: error }).eq("id", contactId);
      return { ok: false, error };
    }
    try {
      const [icpContext, trainingConfig] = await Promise.all([
        loadClientIcpContext(db, clientId),
        loadActiveModelTrainingConfig(db, clientId),
      ]);
      const input: MessageInput = {
        first_name: contact.first_name, last_name: contact.last_name, job_title: contact.job_title,
        linkedin_headline: contact.linkedin_headline, seniority: contact.seniority,
        company_name: company.company_name, company_size: company.company_size,
        company_type: company.company_type, tool_primary: company.tool_primary,
        tool_secondary: company.tool_secondary, fit_signals: company.fit_signals,
        icp_context: icpContext
      };
      const generated = await generateMessages(input, trainingConfig);
      icebreaker = generated.linkedin_icebreaker;
      subject = generated.email_subject;
      emailBody = generated.email_body;
      model_used = generated.model_used;
      messages_generated = true;
      await db.from("contacts").update({ linkedin_icebreaker: icebreaker, email_subject: subject, email_body: emailBody }).eq("id", contactId);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to generate messages";
      await db.from("contacts").update({ lemlist_push_error: `messageGenerator: ${error}` }).eq("id", contactId);
      return { ok: false, error: `messageGenerator: ${error}` };
    }
  }

  if (blank(icebreaker) || blank(subject) || blank(emailBody)) {
    const faltan = [blank(icebreaker) && "icebreaker", blank(subject) && "email_subject", blank(emailBody) && "email_body"].filter(Boolean).join(", ");
    const error = `No se empuja a Lemlist: ${faltan} quedó en blanco`;
    await db.from("contacts").update({ lemlist_push_error: error }).eq("id", contactId);
    return { ok: false, error };
  }

  const push = await addLeadToCampaign(campaignId, {
    linkedinUrl: contact.linkedin_url,
    email: contact.email,
    firstName: contact.first_name,
    lastName: contact.last_name,
    companyName: company?.company_name ?? null,
    jobTitle: contact.job_title,
    phone: contact.phone,
    icebreaker: icebreaker!,
    emailSubject: subject!,
    emailBody: emailBody!,
    bullseye_fit_score: contact.fit_score,
    bullseye_fit_reason: contact.fit_reason,
    bullseye_fit_action: "enrich"
  });

  if (!push.ok) {
    const summary = `Lemlist push ${push.status}: ${push.error}`;
    await db.from("contacts").update({ lemlist_push_error: summary }).eq("id", contactId);
    return { ok: false, error: push.error, status: push.status, debug: push.debug };
  }

  await db.from("contacts").update({ lemlist_pushed_at: new Date().toISOString(), lemlist_push_error: null }).eq("id", contactId);
  return { ok: true, lead_id: push.leadId, messages_generated, model_used };
}
