import type { SupabaseClient } from "@supabase/supabase-js";

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

// Mapea el company_type interno al select de Clay (lab/clinic/DSO).
function mapCompanyTypeForClay(t: string | null): string | null {
  if (!t) return null;
  if (t === "lab") return "lab";
  if (t === "multi_clinic") return "clinic";
  if (t === "dso") return "DSO";
  return null;
}

export async function pushContactToClay(
  db: SupabaseClient,
  contactId: string,
  options: { force?: boolean } = {}
): Promise<PushContactResult> {
  const webhookUrl = process.env.CLAY_CONTACTS_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      ok: false,
      contact_id: contactId,
      status: 500,
      error: "CLAY_CONTACTS_WEBHOOK_URL is not configured"
    };
  }

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, clay_pushed_at"
    )
    .eq("id", contactId)
    .maybeSingle();
  if (cErr) {
    return { ok: false, contact_id: contactId, status: 500, error: cErr.message };
  }
  if (!contact) {
    return {
      ok: false,
      contact_id: contactId,
      status: 404,
      error: "Contact not found",
      skipped: "not_found"
    };
  }
  if (contact.prefilter_result !== "yes") {
    return {
      ok: false,
      contact_id: contactId,
      status: 400,
      error: "Only pre-filter YES contacts can be pushed to Clay",
      skipped: "not_yes"
    };
  }
  if (contact.clay_pushed_at && !options.force) {
    return {
      ok: false,
      contact_id: contactId,
      status: 409,
      error: "Contact already pushed to Clay",
      skipped: "already_pushed"
    };
  }

  const { data: company, error: coErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_type, company_size, cad_software, scanner_technology, fit_signals"
    )
    .eq("id", contact.company_id)
    .maybeSingle();
  if (coErr) {
    return { ok: false, contact_id: contactId, status: 500, error: coErr.message };
  }
  if (!company) {
    return {
      ok: false,
      contact_id: contactId,
      status: 400,
      error: "Contact has no associated company",
      skipped: "no_company"
    };
  }

  const payload = {
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    job_title: contact.job_title ?? "",
    linkedin_headline: contact.linkedin_headline ?? "",
    linkedin_url: contact.linkedin_url ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    seniority: contact.seniority ?? "",
    tenure: contact.tenure ?? "",
    company_name: company.company_name,
    company_type: mapCompanyTypeForClay(company.company_type),
    company_size: company.company_size ?? null,
    cad_software: company.cad_software ?? "",
    scanner_technology: company.scanner_technology ?? "",
    fit_signals: company.fit_signals ?? "",
    bullseye_company_id: company.id,
    bullseye_contact_id: contact.id
  };

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
    await db.from("contacts").update({ clay_push_error: message }).eq("id", contact.id);
    return { ok: false, contact_id: contactId, status: 502, error: message };
  }

  if (!clayRes.ok) {
    const text = await clayRes.text().catch(() => "");
    const message = `Clay responded ${clayRes.status}: ${text.slice(0, 300) || "no body"}`;
    await db.from("contacts").update({ clay_push_error: message }).eq("id", contact.id);
    return { ok: false, contact_id: contactId, status: 502, error: message };
  }

  const pushedAt = new Date().toISOString();
  const { error: updateErr } = await db
    .from("contacts")
    .update({ clay_pushed_at: pushedAt, clay_push_error: null })
    .eq("id", contact.id);
  if (updateErr) {
    return { ok: false, contact_id: contactId, status: 500, error: updateErr.message };
  }

  return { ok: true, contact_id: contactId, clay_pushed_at: pushedAt };
}
