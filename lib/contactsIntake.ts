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
  duplicates: number;
};

export type PushDetail = {
  contact_id: string;
  result: string;
  skipped?: string;
  error?: string;
};

export type ContactOutcome = {
  name: string;
  linkedin_url: string | null;
  outcome: "yes" | "no" | "already_exists" | "duplicate_other_company";
  detail?: string;
};

// Traduce el estado real del contacto existente a algo accionable: "ya existe" no dice
// si nunca llegó a Lemlist, está atascado en Clay, o ya fue contactado — y esa es
// justamente la pregunta que hace el usuario cuando ve "ya existía en esta empresa".
function describeExistingStatus(prev: {
  status?: string | null;
  fit_action?: string | null;
  lemlist_pushed_at?: string | null;
  clay_push_error?: string | null;
}): string {
  if (prev.lemlist_pushed_at) return "ya está en la campaña de Lemlist";
  if (prev.fit_action === "enrich") return "aprobado en Clay, pendiente de enviar a Lemlist";
  if (prev.fit_action === "manual_review") return "en revisión manual pendiente (Clay)";
  if (prev.fit_action === "discard") return "descartado por el scoring de Clay";
  if (prev.clay_push_error) return `nunca llegó a Clay — error: ${prev.clay_push_error}`;
  if (prev.status === "pending") return "pendiente de scoring en Clay";
  return `estado actual: ${prev.status ?? "desconocido"}`;
}

export type IntakeResult =
  | { ok: true; summary: IntakeSummary; pushDetails: PushDetail[]; outcomes: ContactOutcome[] }
  | { ok: false; status: number; error: string };

export type IntakeOptions = {
  auto_push_clay?: boolean; // default true — false salta el push a Clay (ej. búsqueda manual, que va directo a Lemlist)
};

export async function intakeContactsForCompany(
  db: SupabaseClient,
  companyId: string,
  raws: RawContact[],
  source: string = "clay",
  opts: IntakeOptions = {}
): Promise<IntakeResult> {
  const autoPushClay = opts.auto_push_clay ?? true;
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_type, company_name, client_id")
    .eq("id", companyId)
    .maybeSingle();
  if (cErr) return { ok: false, status: 500, error: cErr.message };
  if (!company) return { ok: false, status: 404, error: "Company not found" };

  // El índice único de la tabla es (client_id, lower(linkedin_url)) — es decir,
  // el mismo linkedin_url no puede repetirse en ningún company_id del mismo cliente.
  // Por eso el chequeo de duplicados debe hacerse por client_id, no solo por company_id,
  // o el INSERT de abajo falla por violación de constraint cuando el contacto ya
  // existe bajo otra empresa del mismo cliente.
  const clientId = (company as any).client_id ?? null;
  const existingQuery = db
    .from("contacts")
    .select("id, company_id, linkedin_url, email, first_name, last_name, linkedin_headline, seniority, status, fit_action, lemlist_pushed_at, clay_push_error");
  const { data: existing, error: exErr } = clientId
    ? await existingQuery.eq("client_id", clientId)
    : await existingQuery.eq("company_id", companyId);
  if (exErr) return { ok: false, status: 500, error: exErr.message };

  const normalizeEmail = (e?: string | null) => (e ?? "").trim().toLowerCase() || null;
  const nameKeyOf = (first?: string | null, last?: string | null) =>
    `${(first ?? "").trim().toLowerCase()}|${(last ?? "").trim().toLowerCase()}`;
  const EMPTY_NAME_KEY = nameKeyOf(null, null);

  // Mapa linkedin_url → registro existente para actualizar headline/seniority
  const existingByUrl = new Map(
    (existing ?? [])
      .filter((r) => r.linkedin_url)
      .map((r) => [(normalizeLinkedInUrl(r.linkedin_url) ?? "").toLowerCase(), r])
  );
  // Mapa email → registro existente (hay un índice único por client_id+email en la DB).
  const existingByEmail = new Map(
    (existing ?? [])
      .filter((r) => r.email)
      .map((r) => [normalizeEmail(r.email) as string, r])
  );
  // Sin linkedin_url ni email no hay identificador único real — el mismo lead
  // puede llegar duplicado varias veces desde Lemlist (ej. agregado más de una
  // vez a la campaña puente). Como último recurso, deduplicamos por nombre
  // dentro de la MISMA empresa (nunca cross-empresa: dos personas distintas
  // pueden compartir nombre en compañías distintas).
  const existingByNameInCompany = new Map(
    (existing ?? [])
      .filter((r) => r.company_id === companyId && nameKeyOf(r.first_name, r.last_name) !== EMPTY_NAME_KEY)
      .map((r) => [nameKeyOf(r.first_name, r.last_name), r])
  );

  const seenUrl = new Set(existingByUrl.keys());
  const seenEmail = new Set(existingByEmail.keys());
  const seenNameInCompany = new Set(existingByNameInCompany.keys());

  const summary: IntakeSummary = { inserted: 0, yes: 0, no: 0, skipped: 0, duplicates: 0 };
  const rows: any[] = [];
  const outcomes: ContactOutcome[] = [];

  for (const c of raws) {
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "Sin nombre";
    const normalized = normalizeLinkedInUrl(c.linkedin_url);
    const linkedin = (normalized ?? "").toLowerCase();
    const email = normalizeEmail(c.email);
    const nameKey = nameKeyOf(c.first_name, c.last_name);

    let dupKey: string | null = null;
    let dupMap: Map<string, any> | null = null;
    let dupSeen: Set<string> | null = null;
    if (linkedin && seenUrl.has(linkedin)) {
      dupKey = linkedin; dupMap = existingByUrl; dupSeen = seenUrl;
    } else if (email && seenEmail.has(email)) {
      dupKey = email; dupMap = existingByEmail; dupSeen = seenEmail;
    } else if (!linkedin && !email && nameKey !== EMPTY_NAME_KEY && seenNameInCompany.has(nameKey)) {
      dupKey = nameKey; dupMap = existingByNameInCompany; dupSeen = seenNameInCompany;
    }

    if (dupKey && dupMap && dupSeen) {
      const prev = dupMap.get(dupKey);
      if (prev && prev.company_id !== companyId) {
        // Ya existe con este mismo linkedin_url/email pero bajo otra empresa del
        // mismo cliente — insertarlo violaría el índice único, así que lo salteamos.
        summary.duplicates += 1;
        summary.skipped += 1;
        outcomes.push({ name, linkedin_url: normalized, outcome: "duplicate_other_company", detail: describeExistingStatus(prev) });
        continue;
      }
      // Si el contacto existe pero fue descartado por pre-filter, borrarlo y reinsertarlo
      // para que el nuevo cargo (posiblemente fit) sea re-evaluado
      if (prev && prev.status === "discarded") {
        await db.from("contacts").delete().eq("id", prev.id);
        dupMap.delete(dupKey);
        dupSeen.delete(dupKey);
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
        outcomes.push({ name, linkedin_url: normalized, outcome: "already_exists", detail: prev ? describeExistingStatus(prev) : undefined });
        continue;
      }
    }
    if (linkedin) seenUrl.add(linkedin);
    if (email) seenEmail.add(email);
    if (!linkedin && !email && nameKey !== EMPTY_NAME_KEY) seenNameInCompany.add(nameKey);

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
    outcomes.push({ name, linkedin_url: normalized, outcome: prefilter });

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
      status:           prefilter === "yes" ? "pending" : "discarded",
      source
    });
  }

  if (rows.length === 0) return { ok: true, summary, pushDetails: [], outcomes };

  const { data: inserted, error: insertErr } = await db
    .from("contacts")
    .insert(rows)
    .select("id, prefilter_result");
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  summary.inserted = rows.length;

  if (!autoPushClay) {
    return { ok: true, summary, pushDetails: [], outcomes };
  }

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

  return { ok: true, summary, pushDetails, outcomes };
}
