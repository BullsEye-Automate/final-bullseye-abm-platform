import type { SupabaseClient } from "@supabase/supabase-js";
import { runPrefilter } from "./prefilter";
import type { BuyerPersonas } from "./supabase";

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
    .select("id, company_type, company_name, company_size")
    .eq("id", companyId)
    .maybeSingle();
  if (cErr) return { ok: false, status: 500, error: cErr.message };
  if (!company) return { ok: false, status: 404, error: "Company not found" };

  // Buyer personas del ICP activo — alimenta el pre-filtro. Si no hay
  // ICP o no tiene buyer_personas, runPrefilter cae al default.
  const { data: icp } = await db
    .from("icp_config")
    .select("buyer_personas")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const buyerPersonas =
    ((icp as { buyer_personas?: BuyerPersonas } | null)?.buyer_personas as BuyerPersonas | null) ??
    null;

  const { data: existing, error: exErr } = await db
    .from("contacts")
    .select("linkedin_url, email")
    .eq("company_id", companyId);
  if (exErr) return { ok: false, status: 500, error: exErr.message };
  // Dedup por LinkedIn URL y también por email — los contactos scrapeados de
  // la web suelen no tener LinkedIn URL pero sí email, así que sin el dedup
  // por email se duplicarían al re-scrapear.
  const seen = new Set(
    (existing ?? [])
      .map((r) => (r.linkedin_url ?? "").toLowerCase().trim())
      .filter(Boolean)
  );
  const seenEmail = new Set(
    (existing ?? [])
      .map((r) => (r.email ?? "").toLowerCase().trim())
      .filter(Boolean)
  );

  const summary: IntakeSummary = { inserted: 0, yes: 0, no: 0, skipped: 0 };
  const rows: any[] = [];

  for (const c of raws) {
    const linkedin = (c.linkedin_url ?? "").toLowerCase().trim();
    const email = (c.email ?? "").toLowerCase().trim();
    if (linkedin && seen.has(linkedin)) {
      summary.skipped += 1;
      continue;
    }
    if (email && seenEmail.has(email)) {
      summary.skipped += 1;
      continue;
    }
    if (linkedin) seen.add(linkedin);
    if (email) seenEmail.add(email);

    let prefilter: "yes" | "no" = "no";
    try {
      prefilter = await runPrefilter({
        job_title: c.job_title ?? null,
        linkedin_headline: c.linkedin_headline ?? null,
        company_type: company.company_type ?? null,
        company_size: company.company_size ?? null,
        buyer_personas: buyerPersonas
      });
    } catch {
      // Si Claude falla, marcamos yes para no descartar el contacto por error de infra.
      prefilter = "yes";
    }
    if (prefilter === "yes") summary.yes += 1;
    else summary.no += 1;

    rows.push({
      company_id: companyId,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      job_title: c.job_title ?? null,
      linkedin_headline: c.linkedin_headline ?? null,
      linkedin_url: c.linkedin_url ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      seniority: c.seniority ?? null,
      tenure: c.tenure ?? null,
      prefilter_result: prefilter,
      status: prefilter === "yes" ? "pending" : "discarded"
    });
  }

  if (rows.length === 0) return { ok: true, summary };

  const { error: insertErr } = await db.from("contacts").insert(rows);
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  summary.inserted = rows.length;

  // Si la empresa estaba marcada como "sin contactos" por el loop de Clay
  // y ahora le entran contactos (de la web, o de un re-run de Find People),
  // limpiamos el flag para que el aviso desaparezca de la UI.
  await db.from("companies").update({ clay_no_contacts_at: null }).eq("id", companyId);

  return { ok: true, summary };
}
