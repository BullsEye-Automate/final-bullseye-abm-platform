import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLinkedInUrl } from "./normalizeLinkedIn";

export type PushContactOk = {
  ok: true;
  contact_id: string;
  clay_pushed_at: string;
};

export type PushContactErr = {
  ok: false;
  contact_id: string;
  status: number;
  error: string;
  skipped?: "already_pushed" | "not_yes" | "not_found" | "no_company";
};

export type PushContactResult = PushContactOk | PushContactErr;

export async function pushContactToClay(
  db: SupabaseClient,
  contactId: string,
  options: { force?: boolean } = {}
): Promise<PushContactResult> {
  console.log(`[pushContact] START contactId=${contactId} force=${!!options.force}`);

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, clay_pushed_at"
    )
    .eq("id", contactId)
    .maybeSingle();

  if (cErr) {
    console.error(`[pushContact] DB error fetching contact:`, cErr.message);
    return { ok: false, contact_id: contactId, status: 500, error: cErr.message };
  }
  if (!contact) {
    console.warn(`[pushContact] SKIP not_found contactId=${contactId}`);
    return { ok: false, contact_id: contactId, status: 404, error: "Contact not found", skipped: "not_found" };
  }

  console.log(`[pushContact] contact fetched: prefilter_result=${contact.prefilter_result} clay_pushed_at=${contact.clay_pushed_at} linkedin_url=${contact.linkedin_url}`);

  if (contact.prefilter_result !== "yes") {
    console.warn(`[pushContact] SKIP not_yes prefilter_result=${contact.prefilter_result}`);
    return { ok: false, contact_id: contactId, status: 400, error: "Only pre-filter YES contacts can be pushed to Clay", skipped: "not_yes" };
  }
  if (contact.clay_pushed_at && !options.force) {
    console.warn(`[pushContact] SKIP already_pushed clay_pushed_at=${contact.clay_pushed_at}`);
    return { ok: false, contact_id: contactId, status: 409, error: "Contact already pushed to Clay", skipped: "already_pushed" };
  }

  const { data: company, error: coErr } = await db
    .from("companies")
    .select("id, client_id, company_name, company_size, company_country, fit_signals")
    .eq("id", contact.company_id)
    .maybeSingle();

  if (coErr) {
    console.error(`[pushContact] DB error fetching company:`, coErr.message);
    return { ok: false, contact_id: contactId, status: 500, error: coErr.message };
  }
  if (!company) {
    console.warn(`[pushContact] SKIP no_company company_id=${contact.company_id}`);
    return { ok: false, contact_id: contactId, status: 400, error: "Contact has no associated company", skipped: "no_company" };
  }

  console.log(`[pushContact] company fetched: id=${company.id} client_id=${company.client_id} name=${company.company_name}`);

  // Resuelve la URL del webhook: primero desde la config del cliente en Supabase, luego env var.
  let webhookUrl: string | null | undefined = process.env.CLAY_CONTACTS_WEBHOOK_URL;
  console.log(`[pushContact] env CLAY_CONTACTS_WEBHOOK_URL=${webhookUrl ? "SET" : "NOT SET"}`);

  if (company.client_id) {
    const { data: client } = await db
      .from("clients")
      .select("clay_contacts_webhook_url")
      .eq("id", company.client_id)
      .maybeSingle();
    console.log(`[pushContact] client.clay_contacts_webhook_url=${client?.clay_contacts_webhook_url ? "SET" : "NOT SET"}`);
    if (client?.clay_contacts_webhook_url) webhookUrl = client.clay_contacts_webhook_url;
  }

  if (!webhookUrl) {
    console.error(`[pushContact] ABORT no webhook URL configured client_id=${company.client_id}`);
    return { ok: false, contact_id: contactId, status: 500, error: "No hay webhook URL configurada para este cliente (Clay → Contacts)" };
  }

  const payload = {
    bullseye_contact_id: contact.id,
    bullseye_company_id: company.id,
    first_name:          contact.first_name        ?? "",
    last_name:           contact.last_name         ?? "",
    job_title:           contact.job_title         ?? "",
    linkedin_url:        normalizeLinkedInUrl(contact.linkedin_url) ?? "",
    linkedin_headline:   contact.linkedin_headline ?? "",
    email:               contact.email             ?? "",
    phone:               contact.phone             ?? "",
    seniority:           contact.seniority         ?? "",
    tenure:              contact.tenure            ?? "",
    company_name:        company.company_name,
    company_size:        company.company_size       ?? null,
    company_country:     (company as any).company_country ?? null,
    fit_signals:         company.fit_signals        ?? "",
  };

  console.log(`[pushContact] FETCH POST to webhook payload.linkedin_url=${payload.linkedin_url}`);

  let clayRes: Response;
  try {
    clayRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } catch (err: any) {
    const message = err?.message ?? "Network error pushing to Clay";
    console.error(`[pushContact] FETCH EXCEPTION:`, message);
    await db.from("contacts").update({ clay_push_error: message }).eq("id", contact.id);
    return { ok: false, contact_id: contactId, status: 502, error: message };
  }

  console.log(`[pushContact] Clay response status=${clayRes.status} ok=${clayRes.ok}`);

  if (!clayRes.ok) {
    const text = await clayRes.text().catch(() => "");
    const message = `Clay responded ${clayRes.status}: ${text.slice(0, 300) || "no body"}`;
    console.error(`[pushContact] Clay error:`, message);
    await db.from("contacts").update({ clay_push_error: message }).eq("id", contact.id);
    return { ok: false, contact_id: contactId, status: 502, error: message };
  }

  const pushedAt = new Date().toISOString();
  const { error: updateErr } = await db
    .from("contacts")
    .update({ clay_pushed_at: pushedAt, clay_push_error: null })
    .eq("id", contact.id);
  if (updateErr) {
    console.error(`[pushContact] DB error updating clay_pushed_at:`, updateErr.message);
    return { ok: false, contact_id: contactId, status: 500, error: updateErr.message };
  }

  console.log(`[pushContact] SUCCESS contactId=${contactId} pushedAt=${pushedAt}`);
  return { ok: true, contact_id: contactId, clay_pushed_at: pushedAt };
}
