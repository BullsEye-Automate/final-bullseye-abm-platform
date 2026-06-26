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

export type PushDetail = {
  contact_id: string;
  result: string;
  skipped?: string;
  error?: string;
};

export type IntakeResult =
  | { ok: true; summary: IntakeSummary; pushDetails: PushDetail[] }
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
    .select("id, linkedin_url, linkedin_headline, seniority, status")
    .eq("company_id", companyId);
  if (exErr) return { ok: false, status: 500, error: exErr.message };

  // Mapa linkedin_url → registro existente para actualizar headline/seniority
  const existingByUrl = new Map(
    (existing ?? [])
      .filter((r) => r.linkedin_url)
      .map((r) => [(normalizeLinkedInUrl(r.linkedin_url) ?? "").toLowerCase(), r])
  );

  const seen = new Set(existingByUrl.keys());

  const summary: IntakeSummary = { inserted: 0, yes: 0, no: 0, skipped: 0 };
  const rows: any[] = [];

  for (const c of raws) {
    const normalized = normalizeLinkedInUrl(c.linkedin_url);
    const linkedin = (normalized ?? "").toLowerCase();
    if (linkedin && seen.has(linkedin)) {
      const prev = existingByUrl.get(linkedin);
      // Si el contacto existe pero fue descartado por pre-filter, borrarlo y reinsertarlo
      // para que el nuevo cargo (posiblemente fit) sea re-evaluado
      if (prev && prev.status === "discarded") {
        await db.from("contacts").delete().eq("id", prev.id);
        existingByUrl.delete(linkedin);
        seen.delete(linkedin);
        // Continúa el flujo normal para insertar el contacto actualizado
      } else {
        // Contacto activo — actualizar headline/seniority si llegaron nuevos
        if (prev) {
          const update: Record<string, string | null> = {};
          if (c.linkedin_headline?.trim() && !prev.linkedin_headline) {
            update.linkedin_headline = c.linkedin_headline;
            update.email_subject       = null;
            update.email_body          = null;
            update.linkedin_icebreaker = null;
          }
          if (c.seniority?.trim() && !prev.seniority) {
            update.seniority = c.seniority;
          }
          if (Object.keys(update).length > 0) {
            await db.from("contacts").update(update).eq("id", prev.id);
          }
        }
        summary.skipped += 1;
        continue;
      }
    }
    if (linkedin) seen.add(linkedin);

    let prefilter: "yes" | "no" = "no";
    try {
      prefilter = await runPrefilter({
        job_title: c.job_title ?? null,
        linkedin_headline: c.linkedin_headline ?? null,
        company_type: company.company_type ?? null,
        company_name: company.company_name ?? null,
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

  if (rows.length === 0) return { ok: true, summary, pushDetails: [] };

  const { data: inserted, error: insertErr } = await db
    .from("contacts")
    .insert(rows)
    .select("id, prefilter_result");
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  summary.inserted = rows.length;

  // Auto-push a Clay: contactos con prefilter_result = 'yes' recién insertados.
  const yesList = (inserted ?? []).filter((r) => r.prefilter_result === "yes");
  const pushResults = await Promise.all(
    yesList.map((r) => pushContactToClay(db, r.id).catch((err) => ({
      ok: false as const,
      contact_id: r.id,
      status: 500,
      error: String(err?.message ?? err),
    })))
  );

  const pushDetails: PushDetail[] = pushResults.map((res) => ({
    contact_id: res.contact_id,
    result: res.ok ? "pushed" : "failed",
    skipped: !res.ok ? (res as any).skipped : undefined,
    error:   !res.ok ? res.error : undefined,
  }));

  return { ok: true, summary, pushDetails };
}
