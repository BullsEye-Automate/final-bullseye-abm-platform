// Push de un contacto aprobado a Lemlist. Compartido entre el endpoint
// /api/contacts/[id]/decision (al aprobar desde Revisión manual) y el
// endpoint /api/contacts/[id]/lemlist-retry (cuando hay que reintentar
// después de un error transitorio de Lemlist API).
//
// Si el contacto no tiene icebreaker/subject/body, los genera con Claude
// y los persiste. Después llama a addLeadToCampaign y persiste el resultado
// en lemlist_pushed_at o lemlist_push_error.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addLeadToCampaign } from "./lemlist";
import { generateMessages, type MessageInput } from "./messageGenerator";
import { computeContactFitScore, type ScoreInput } from "./contactScoring";
import { getPrimaryLemlistCampaignId } from "./lemlistCampaigns";

export type LemlistPushOk = {
  ok: true;
  lead_id?: string;
  messages_generated: boolean;
  model_used?: string;
};

export type LemlistPushErr = {
  ok: false;
  error: string;
  status?: number;
  debug?: unknown;
};

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
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
} | null;

export async function pushApprovedToLemlist(
  db: SupabaseClient,
  contactId: string,
  contact: LemlistPushContact,
  company: LemlistPushCompany,
  options?: { force_regenerate?: boolean }
): Promise<LemlistPushResult> {
  // Cuando force_regenerate=true, ignoramos los mensajes preexistentes en el
  // contacto (típicamente generados por Clay con prompts viejos) y forzamos
  // la regeneración con la config activa de /entrenar-modelo. Default false
  // para mantener compat con el flujo de manual_review (donde los mensajes
  // siempre nacen NULL y se generan acá).
  if (options?.force_regenerate) {
    contact = {
      ...contact,
      linkedin_icebreaker: null,
      email_subject: null,
      email_body: null
    };
  }

  // Fallback de fit_score: si el contacto no tiene score (típicamente vino
  // por Sales Nav, web scrape o manual import — bypasea Clay's Lead Scoring),
  // lo calculamos con Claude usando los mismos criterios que Clay. Resultado
  // queda persistido en contacts.fit_score y de ahí HubSpot lo pickea via
  // syncContactToHubSpot que corre después del push. Best-effort: si falla,
  // seguimos sin score (mejor un push sin score que romper el flow).
  if (contact.fit_score == null && company) {
    try {
      const scoreInput: ScoreInput = {
        first_name: contact.first_name,
        last_name: contact.last_name,
        job_title: contact.job_title,
        linkedin_headline: contact.linkedin_headline,
        seniority: contact.seniority,
        company_name: company.company_name,
        company_type: company.company_type,
        company_size: company.company_size,
        cad_software: company.cad_software,
        scanner_technology: company.scanner_technology,
        fit_signals: company.fit_signals
      };
      const scored = await computeContactFitScore(scoreInput);
      // Solo persistimos campos críticos. NO sobreescribimos fit_action si
      // ya existe (puede haber sido seteado por Clay) — el scoring de la
      // app es solo fallback de fit_score cuando Clay no opinó.
      const patch: Record<string, unknown> = {
        fit_score: scored.fit_score,
        fit_reason: scored.fit_reason,
        fit: scored.fit
      };
      await db.from("contacts").update(patch).eq("id", contactId);
      contact = { ...contact, fit_score: scored.fit_score, fit_reason: scored.fit_reason };
    } catch {
      // ignore — el push sigue sin score.
    }
  }

  const campaignId = getPrimaryLemlistCampaignId();
  if (!campaignId) {
    const error = "LEMLIST_CAMPAIGN_ID is not configured";
    await db.from("contacts").update({ lemlist_push_error: error }).eq("id", contactId);
    return { ok: false, error };
  }

  // Un string presente pero en blanco ("", "  ", "\n") cuenta como faltante:
  // si no, el push manda icebreaker:"  " y Lemlist avisa "has no value".
  const blank = (s: string | null | undefined): boolean => !s || !s.trim();

  // 1) Generar mensajes si faltan (manual_review no dispara las AI cols de Clay).
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
      const input: MessageInput = {
        first_name: contact.first_name,
        last_name: contact.last_name,
        job_title: contact.job_title,
        linkedin_headline: contact.linkedin_headline,
        seniority: contact.seniority,
        company_name: company.company_name,
        company_size: company.company_size,
        company_type: company.company_type,
        cad_software: company.cad_software,
        scanner_technology: company.scanner_technology,
        fit_signals: company.fit_signals
      };
      const generated = await generateMessages(input);
      icebreaker = generated.linkedin_icebreaker;
      subject = generated.email_subject;
      emailBody = generated.email_body;
      model_used = generated.model_used;
      messages_generated = true;

      await db
        .from("contacts")
        .update({
          linkedin_icebreaker: icebreaker,
          email_subject: subject,
          email_body: emailBody
        })
        .eq("id", contactId);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to generate messages";
      await db
        .from("contacts")
        .update({ lemlist_push_error: `messageGenerator: ${error}` })
        .eq("id", contactId);
      return { ok: false, error: `messageGenerator: ${error}` };
    }
  }

  // 2) Guard: nunca empujar un lead con icebreaker/subject/body en blanco.
  // Lemlist mostraría "{{icebreaker}} has no value" y el toque de LinkedIn
  // saldría roto. Mejor abortar y dejar el error visible para reintentar.
  if (blank(icebreaker) || blank(subject) || blank(emailBody)) {
    const faltan = [
      blank(icebreaker) && "icebreaker",
      blank(subject) && "email_subject",
      blank(emailBody) && "email_body"
    ]
      .filter(Boolean)
      .join(", ");
    const error = `No se empuja a Lemlist: ${faltan} quedó en blanco después de generar mensajes`;
    await db.from("contacts").update({ lemlist_push_error: error }).eq("id", contactId);
    return { ok: false, error };
  }

  // 3) Push a Lemlist.
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
    wecad_fit_score: contact.fit_score,
    wecad_fit_reason: contact.fit_reason,
    wecad_fit_action: "enrich"
  });

  if (!push.ok) {
    const summary = `Lemlist push ${push.status}: ${push.error}`;
    await db.from("contacts").update({ lemlist_push_error: summary }).eq("id", contactId);
    return { ok: false, error: push.error, status: push.status, debug: push.debug };
  }

  await db
    .from("contacts")
    .update({
      lemlist_pushed_at: new Date().toISOString(),
      lemlist_push_error: null
    })
    .eq("id", contactId);

  return { ok: true, lead_id: push.leadId, messages_generated, model_used };
}
