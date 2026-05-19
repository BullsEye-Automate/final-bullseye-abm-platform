import type { SupabaseClient } from "@supabase/supabase-js";
import { runPrefilter } from "./prefilter";
import type { BuyerPersonas } from "./supabase";
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
  /**
   * Cantidad descartada por falta de linkedin_url cuando la fuente lo exige
   * (clay / sales_navigator). Web scrape y manual permiten null.
   */
  skipped_no_linkedin: number;
};

export type IntakeResult =
  | { ok: true; summary: IntakeSummary }
  | { ok: false; status: number; error: string };

export type ContactSource = "clay" | "sales_navigator" | "web_scrape" | "manual";

export type IntakeOptions = {
  /**
   * Si auto_push_clay=true (default), los contactos pre-filter YES se
   * pushean automáticamente a Clay para Lead Scoring. Si false, se
   * insertan en la base pero NO van a Clay (el caller decide qué hacer
   * después — típicamente push directo a Lemlist sin pasar por Clay,
   * para sources que ya curan manualmente como sales_navigator).
   */
  auto_push_clay?: boolean;
};

export async function intakeContactsForCompany(
  db: SupabaseClient,
  companyId: string,
  raws: RawContact[],
  source: ContactSource = "manual",
  options: IntakeOptions = {}
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

  const summary: IntakeSummary = {
    inserted: 0,
    yes: 0,
    no: 0,
    skipped: 0,
    skipped_no_linkedin: 0
  };
  const rows: any[] = [];

  // Fuentes que exigen LinkedIn URL sí o sí. Web scrape y manual lo
  // permiten en null (las páginas "Our Team" a menudo no linkean perfiles
  // personales).
  const requiresLinkedin = source === "clay" || source === "sales_navigator";

  for (const c of raws) {
    const linkedin = (c.linkedin_url ?? "").toLowerCase().trim();
    const email = (c.email ?? "").toLowerCase().trim();
    if (requiresLinkedin && !linkedin) {
      summary.skipped_no_linkedin += 1;
      continue;
    }
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
      status: prefilter === "yes" ? "pending" : "discarded",
      source
    });
  }

  if (rows.length === 0) return { ok: true, summary };

  const { error: insertErr } = await db.from("contacts").insert(rows);
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  summary.inserted = rows.length;

  // Si la empresa estaba marcada como "sin contactos" por el loop de Clay
  // y ahora le entran contactos (de la web, de Sales Navigator, o de un
  // re-run de Find People), limpiamos el flag para que el aviso desaparezca
  // de la UI. También limpiamos sales_nav_status para que salga del módulo
  // /sales-navigator.
  await db
    .from("companies")
    .update({ clay_no_contacts_at: null, sales_nav_status: null })
    .eq("id", companyId);

  // Auto-push a Clay (Sprint 9): los contactos pre-filter YES se envían
  // automáticamente a la tabla Contacts de Clay para que corra Lead
  // Scoring. Antes era un paso manual ("Prospectar todos en Clay") pero
  // en la práctica el SDR siempre lo hacía — un click sin valor.
  // Ahora "Pendientes" pasa a ser solo un estado transitorio mientras Clay
  // procesa. Una vez Clay devuelve el scoring vía webhook scored-contacts,
  // el contacto salta a "Por aprobar" (fit_action='enrich') o "Revisión
  // manual" / "Descartados".
  //
  // Best-effort: si el push falla, el contacto queda en pendientes con
  // clay_push_error y el SDR lo retrentaría con "Prospectar todos en Clay".
  // En paralelo de a 5 para no saturar el webhook de Clay.
  // Saltea contactos que ya fueron pusheados antes (idempotente — dedup
  // en intake puede actualizar fila vs crear una nueva).
  //
  // Si auto_push_clay=false (caller pide skip), no pushea — caso típico
  // de Sales Nav imports donde el contacto ya está curado y va directo
  // a Lemlist sin pasar por el Lead Scoring de Clay.
  const autoPushClay = options.auto_push_clay !== false;
  const idsToPush = autoPushClay
    ? await (async () => {
        const { data } = await db
          .from("contacts")
          .select("id, clay_pushed_at")
          .eq("company_id", companyId)
          .eq("prefilter_result", "yes")
          .is("clay_pushed_at", null);
        return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      })()
    : [];

  const CHUNK = 5;
  for (let i = 0; i < idsToPush.length; i += CHUNK) {
    const chunk = idsToPush.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((cid) =>
        pushContactToClay(db, cid).catch(() => {
          // best-effort: el error queda persistido por pushContactToClay
          // en contacts.clay_push_error; no rompemos el intake.
        })
      )
    );
  }

  return { ok: true, summary };
}
