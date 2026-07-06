import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getClientLemlistConfig, getCampaignLeadsWithDetails, type LemlistLeadDetail } from "@/lib/lemlist";
import { intakeContactsForCompany, type RawContact } from "@/lib/contactsIntake";
import { researchOneCompanyFast } from "@/lib/companyResearchFast";
import { computeContactFitScore, getClientBuyerPersonaRoles } from "@/lib/contactFitScore";
import { detectNameEmailMismatch } from "@/lib/nameEmailMismatch";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { client_id: string; since?: string; until?: string };

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

async function chunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const clientId = body.client_id;
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();

  // 1. Resolver la Campaña puente del CLIENTE ACTIVO — nunca una env var global.
  const config = await getClientLemlistConfig(db, clientId);
  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) {
    return NextResponse.json({ error: "No hay Campaña puente configurada para este cliente. Agregala en Config. cliente." }, { status: 400 });
  }

  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 500 });

  // 2. Traer TODOS los leads de la campaña puente (siempre con detalle completo).
  const leadsResult = await getCampaignLeadsWithDetails(stagingId, apiKey);
  if (!leadsResult.ok) return NextResponse.json({ error: leadsResult.error }, { status: 502 });

  const stagedTotal = leadsResult.leads.length;

  // 3. Filtro de fecha opcional (con holgura). Si Lemlist no trajo fechas para
  // ningún lead, el filtro se ignora y se avisa en la respuesta.
  let leads = leadsResult.leads;
  const dateFilterActive = Boolean(body.since || body.until);
  let dateFilterIgnored = false;
  if (dateFilterActive) {
    const withDates = leads.filter((l) => l.added_at);
    if (withDates.length === 0) {
      dateFilterIgnored = true;
    } else {
      const sinceMs = body.since ? new Date(body.since).getTime() - 12 * 3600000 : null;
      const untilMs = body.until ? new Date(body.until).getTime() + 36 * 3600000 : null;
      leads = leads.filter((l) => {
        if (!l.added_at) return true;
        const t = new Date(l.added_at).getTime();
        if (sinceMs !== null && t < sinceMs) return false;
        if (untilMs !== null && t > untilMs) return false;
        return true;
      });
    }
  }
  const filteredTotal = leads.length;

  // 4. Pre-skip: leads que ya están enviados a Lemlist o descartados no se
  // reprocesan (evita gastar research/IA de nuevo). Los que existen pero
  // todavía no se enviaron SÍ pasan, para que su empresa se procese y
  // aparezcan listos para enviar.
  const candidateUrls = Array.from(
    new Set(leads.map((l) => normalizeLinkedInUrl(l.linkedin_url)).filter((u): u is string => Boolean(u)))
  );
  const blockedUrls = new Set<string>();
  for (let i = 0; i < candidateUrls.length; i += 200) {
    const chunk = candidateUrls.slice(i, i + 200);
    const { data } = await db
      .from("contacts")
      .select("linkedin_url, status, lemlist_pushed_at")
      .eq("client_id", clientId)
      .in("linkedin_url", chunk);
    for (const row of data ?? []) {
      if ((row.lemlist_pushed_at || row.status === "discarded") && row.linkedin_url) {
        blockedUrls.add(row.linkedin_url.toLowerCase());
      }
    }
  }

  let alreadySent = 0;
  const candidateLeads = leads.filter((l) => {
    const norm = normalizeLinkedInUrl(l.linkedin_url);
    if (norm && blockedUrls.has(norm.toLowerCase())) {
      alreadySent++;
      return false;
    }
    return true;
  });

  // 5. Agrupar por nombre de empresa normalizado.
  const skippedNoCompany: { name: string; job_title: string | null }[] = [];
  const groups = new Map<string, LemlistLeadDetail[]>();
  for (const lead of candidateLeads) {
    const rawName = lead.company_name?.trim();
    if (!rawName) {
      skippedNoCompany.push({
        name: `${lead.first_name} ${lead.last_name}`.trim() || lead.email || lead.id,
        job_title: lead.job_title || null,
      });
      continue;
    }
    const norm = normalizeCompanyName(rawName);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(lead);
  }

  const buyerPersonaRoles = await getClientBuyerPersonaRoles(db, clientId);
  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const companiesOut: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let importedCompaniesCreated = 0;
  let importedCompaniesReused = 0;
  let importedContactsYes = 0;
  let importedContactsNo = 0;
  let importedContactsSkipped = 0;

  const groupEntries = Array.from(groups.entries());
  const GROUP_CHUNK = 3;
  for (let i = 0; i < groupEntries.length; i += GROUP_CHUNK) {
    const slice = groupEntries.slice(i, i + GROUP_CHUNK);
    const results = await Promise.all(
      slice.map(async ([, groupLeads]) => {
        const displayName = groupLeads[0].company_name.trim();
        try {
          let companyId: string;
          let created = false;

          const { data: existingCompany } = await db
            .from("companies")
            .select("id")
            .ilike("company_name", displayName)
            .eq("client_id", clientId)
            .maybeSingle();

          if (existingCompany) {
            companyId = existingCompany.id;
            importedCompaniesReused++;
          } else {
            const fast = await researchOneCompanyFast(
              { name: displayName, sampleJobTitles: groupLeads.map((l) => l.job_title).filter(Boolean).slice(0, 5) },
              icpCtx?.content ?? undefined
            );
            const { data: insertedCompany, error: insErr } = await db
              .from("companies")
              .insert({
                company_name: displayName,
                company_type: fast.company_type,
                fit_signals: fast.fit_signals,
                fit_score: fast.fit_score,
                research_summary: fast.research_summary,
                status: "approved",
                approved_at: new Date().toISOString(),
                client_id: clientId,
              })
              .select("id")
              .single();

            if (insErr) {
              const msg = insErr.message.toLowerCase();
              if (msg.includes("duplicate") || msg.includes("unique")) {
                const { data: reused } = await db
                  .from("companies")
                  .select("id")
                  .ilike("company_name", displayName)
                  .eq("client_id", clientId)
                  .maybeSingle();
                if (!reused) throw new Error(insErr.message);
                companyId = reused.id;
                importedCompaniesReused++;
              } else {
                throw new Error(insErr.message);
              }
            } else {
              companyId = insertedCompany!.id;
              created = true;
              importedCompaniesCreated++;
            }
          }

          const { data: companyRow } = await db
            .from("companies")
            .select("company_type, fit_score")
            .eq("id", companyId)
            .maybeSingle();

          const raws: RawContact[] = groupLeads.map((l) => ({
            first_name: l.first_name || null,
            last_name: l.last_name || null,
            job_title: l.job_title || null,
            linkedin_url: l.linkedin_url,
            email: l.email,
            phone: l.phone,
          }));

          const intakeResult = await intakeContactsForCompany(db, companyId, raws, "sales_navigator", { auto_push_clay: false });
          if (!intakeResult.ok) throw new Error(intakeResult.error);

          importedContactsYes += intakeResult.summary.yes;
          importedContactsNo += intakeResult.summary.no;
          importedContactsSkipped += intakeResult.summary.skipped;

          // Contactos YES sin enviar: marcar fit_action='enrich', calcular fit
          // score si falta, y detectar mismatch nombre/email.
          const { data: yesContacts } = await db
            .from("contacts")
            .select("id, job_title, first_name, last_name, email, linkedin_url, fit_score, fit_action")
            .eq("company_id", companyId)
            .eq("prefilter_result", "yes")
            .is("lemlist_pushed_at", null)
            .neq("status", "discarded");

          const contactsOut: Record<string, unknown>[] = [];
          if (yesContacts?.length) {
            const toEnrich = yesContacts.filter((c) => c.fit_action !== "enrich").map((c) => c.id);
            if (toEnrich.length) {
              await db.from("contacts").update({ fit_action: "enrich" }).in("id", toEnrich);
            }

            await chunked(yesContacts, 5, async (c) => {
              let fitScore = c.fit_score;
              if (fitScore == null) {
                fitScore = computeContactFitScore({ jobTitle: c.job_title, roles: buyerPersonaRoles });
                await db.from("contacts").update({ fit_score: fitScore }).eq("id", c.id);
              }
              const mismatch = detectNameEmailMismatch(c.first_name, c.last_name, c.email);
              contactsOut.push({
                id: c.id,
                first_name: c.first_name,
                last_name: c.last_name,
                job_title: c.job_title,
                email: c.email,
                linkedin_url: c.linkedin_url,
                fit_score: fitScore,
                name_email_mismatch: mismatch.mismatch,
                mismatch_reason: mismatch.reason ?? null,
              });
            });
          }

          return {
            company_id: companyId,
            company_name: displayName,
            created,
            fit_score: companyRow?.fit_score ?? null,
            company_type: companyRow?.company_type ?? null,
            contacts: contactsOut,
            yes: intakeResult.summary.yes,
            no: intakeResult.summary.no,
            skipped: intakeResult.summary.skipped,
          };
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          errors.push(`${displayName}: ${msg}`);
          return { company_name: displayName, error: msg };
        }
      })
    );
    companiesOut.push(...results);
  }

  const contactsReady = companiesOut.reduce((acc, c) => acc + ((c.contacts as unknown[] | undefined)?.length ?? 0), 0);

  // 7. NO se borran los leads de la Campaña puente — el DELETE marca al
  // contacto como unsubscribed cross-campaña y saltea el email real.
  return NextResponse.json({
    staged_total: stagedTotal,
    filtered_total: filteredTotal,
    date_filter_active: dateFilterActive,
    date_filter_ignored: dateFilterIgnored,
    skipped_no_company: skippedNoCompany,
    companies: companiesOut,
    imported_companies_created: importedCompaniesCreated,
    imported_companies_reused: importedCompaniesReused,
    imported_contacts_yes: importedContactsYes,
    imported_contacts_no: importedContactsNo,
    imported_contacts_skipped: importedContactsSkipped,
    contacts_ready: contactsReady,
    already_sent: alreadySent,
    matched_url: leadsResult.matched_url,
    deleted: 0,
    errors,
  });
}
