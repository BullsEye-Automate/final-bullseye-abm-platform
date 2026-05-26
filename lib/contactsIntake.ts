import type { SupabaseClient } from "@supabase/supabase-js";
import { runPrefilter } from "./prefilter";
import { normalizeLinkedInUrl } from "./normalizeLinkedIn";
import { pushContactToClay } from "./clayPushContact";

export type RawContact = {
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  linkedin_headline?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  phone?: string | null;
  seniority?: string | null;
  tenure?: string | null;
};

export type IntakeSummary = {
  inserted: number;
  yes: number;
  no: number;
  skipped: number;
};

export type IntakeResult =
  | { ok: true; summary: IntakeSummary }
  | { ok: false; status: number; error: string };

export async function intakeContactsForCompany(
  db: SupabaseClient,
  companyId: string,
  raws: RawContact[]
): Promise<IntakeResult> {
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_type, company_name, client_id")
    .eq("id", companyId)
    .maybeSingle();
  if (cErr) return { ok: false, status: 500, error: cErr.message };
  if (!company) return { ok: false, status: 404, error: "Company not found" };

  const { data: existing, error: exErr } = await db
    .from("contacts")
    .select("linkedin_url")
    .eq("company_id", companyId);
  if (exErr) return { ok: false, status: 500, error: exErr.message };
  const seen = new Set(
    (existing ?? [])
      .map((r) => (normalizeLinkedInUrl(r.linkedin_url) ?? "").toLowerCase())
      .filter(Boolean)
  );

  const summary: IntakeSummary = { inserted: 0, yes: 0, no: 0, skipped: 0 };
  const rows: any[] = [];

  for (const c of raws) {
    const normalized = normalizeLinkedInUrl(c.linkedin_url);
    const linkedin = (normalized ?? "").toLowerCase();
    if (linkedin && seen.has(linkedin)) {
      summary.skipped += 1;
      continue;
    }
    if (linkedin) seen.add(linkedin);

    let prefilter: "yes" | "no" = "no";
    try {
      prefilter = await runPrefilter({
        job_title: c.job_title ?? null,
        linkedin_headline: c.linkedin_headline ?? null,
        company_type: company.company_type ?? null
      });
    } catch {
      // Si Claude falla, marcamos yes para no descartar el contacto por error de infra.
      prefilter = "yes";
    }
    if (prefilter === "yes") summary.yes += 1;
    else summary.no += 1;

    rows.push({
      company_id:       companyId,
      client_id:        (company as any).client_id ?? null,
      first_name:       c.first_name       ?? null,
      last_name:        c.last_name        ?? null,
      job_title:        c.job_title        ?? null,
      linkedin_headline: c.linkedin_headline ?? null,
      linkedin_url:     normalizeLinkedInUrl(c.linkedin_url),
      email:            c.email            ?? null,
      phone:            c.phone            ?? null,
      seniority:        c.seniority        ?? null,
      tenure:           c.tenure           ?? null,
      prefilter_result: prefilter,
      status:           prefilter === "yes" ? "pending" : "discarded"
    });
  }

  if (rows.length === 0) return { ok: true, summary };

  const { data: inserted, error: insertErr } = await db
    .from("contacts")
    .insert(rows)
    .select("id, prefilter_result");
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  summary.inserted = rows.length;

  // Auto-push a Clay: contactos con prefilter_result = 'yes' recién insertados.
  // Fire-and-forget: un fallo de push no revierte el intake.
  const yesList = (inserted ?? []).filter((r) => r.prefilter_result === "yes");
  await Promise.all(yesList.map((r) => pushContactToClay(db, r.id).catch(() => null)));

  return { ok: true, summary };
}
