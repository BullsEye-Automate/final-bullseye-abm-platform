import type { SupabaseClient } from "@supabase/supabase-js";

export type PushOk = {
  ok: true;
  company_id: string;
  clay_pushed_at: string;
};

export type PushErr = {
  ok: false;
  company_id: string;
  status: number;
  error: string;
  skipped?: "already_pushed" | "not_approved" | "not_found";
};

export type PushResult = PushOk | PushErr;

// Mapea el company_type interno al select de Clay (lab/clinic/DSO).
function mapCompanyTypeForClay(t: string | null): string | null {
  if (!t) return null;
  if (t === "lab") return "lab";
  if (t === "multi_clinic") return "clinic";
  if (t === "dso") return "DSO";
  return null;
}

export async function pushCompanyToClay(
  db: SupabaseClient,
  companyId: string,
  options: { force?: boolean } = {}
): Promise<PushResult> {
  const { data: company, error: fetchErr } = await db
    .from("companies")
    .select(
      "id, client_id, company_name, company_website, company_linkedin_url, company_city, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, status, clay_pushed_at, approved_by, approved_at"
    )
    .eq("id", companyId)
    .maybeSingle();
  if (fetchErr) {
    return { ok: false, company_id: companyId, status: 500, error: fetchErr.message };
  }
  if (!company) {
    return {
      ok: false,
      company_id: companyId,
      status: 404,
      error: "Company not found",
      skipped: "not_found"
    };
  }

  // Resuelve la URL del webhook: primero desde la config del cliente en Supabase, luego env var.
  let webhookUrl: string | null | undefined = process.env.CLAY_COMPANIES_WEBHOOK_URL;
  if (company.client_id) {
    const { data: client } = await db
      .from("clients")
      .select("clay_companies_webhook_url")
      .eq("id", company.client_id)
      .maybeSingle();
    if (client?.clay_companies_webhook_url) webhookUrl = client.clay_companies_webhook_url;
  }
  if (!webhookUrl) {
    return {
      ok: false,
      company_id: companyId,
      status: 500,
      error: "No hay webhook URL configurada para este cliente (Clay → Companies)"
    };
  }

  if (company.status !== "approved") {
    return {
      ok: false,
      company_id: companyId,
      status: 400,
      error: "Only approved companies can be pushed to Clay",
      skipped: "not_approved"
    };
  }
  if (company.clay_pushed_at && !options.force) {
    return {
      ok: false,
      company_id: companyId,
      status: 409,
      error: "Company already pushed to Clay",
      skipped: "already_pushed"
    };
  }

  const payload = {
    company_name: company.company_name,
    company_website: company.company_website ?? "",
    company_city: company.company_city ?? "",
    company_size: company.company_size ?? null,
    company_type: mapCompanyTypeForClay(company.company_type),
    cad_software: company.cad_software ?? "",
    scanner_technology: company.scanner_technology ?? "",
    fit_signals: company.fit_signals ?? "",
    fit_score: company.fit_score ?? null,
    linkedin_url: company.company_linkedin_url ?? "",
    approved_by: company.approved_by ?? "",
    approved_at: company.approved_at ?? "",
    status: "approved",
    bullseye_company_id: company.id
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
    await db.from("companies").update({ clay_push_error: message }).eq("id", company.id);
    return { ok: false, company_id: companyId, status: 502, error: message };
  }

  if (!clayRes.ok) {
    const text = await clayRes.text().catch(() => "");
    const message = `Clay responded ${clayRes.status}: ${text.slice(0, 300) || "no body"}`;
    await db.from("companies").update({ clay_push_error: message }).eq("id", company.id);
    return { ok: false, company_id: companyId, status: 502, error: message };
  }

  const pushedAt = new Date().toISOString();
  const { error: updateErr } = await db
    .from("companies")
    .update({ clay_pushed_at: pushedAt, clay_push_error: null })
    .eq("id", company.id);
  if (updateErr) {
    return { ok: false, company_id: companyId, status: 500, error: updateErr.message };
  }

  return { ok: true, company_id: companyId, clay_pushed_at: pushedAt };
}
