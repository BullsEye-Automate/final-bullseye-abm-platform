// Backfill de fit_score para contactos huérfanos.
//
// Disparador: contactos que entraron por Sales Nav / web scrape / manual
// import bypasean Clay's Lead Scoring AI y quedan con fit_score=null. Si
// además fueron pusheados a HubSpot, no matchean ningún filtro de las
// listas Hot/Warm y quedan invisibles para el SDR.
//
// Este endpoint los recorre, calcula fit_score con Claude usando los
// mismos criterios que Clay (lib/contactScoring.ts) y persiste. La
// próxima vez que el contacto se sincronice a HubSpot, el score se
// propaga y entran a las listas.
//
// Procesamiento: en paralelo en chunks de 5, cap de 25 contactos por
// request. Si quedan más, el usuario re-corre.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeContactFitScore, type ScoreInput } from "@/lib/contactScoring";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_LIMIT = 25;
const CONCURRENCY = 5;

type Body = {
  batch_limit?: number;
  // Si true, re-sync a HubSpot inmediatamente después de scorear.
  // Default true para que el score llegue a HubSpot enseguida y los
  // contactos entren a las listas dinámicas sin esperar otro push.
  resync_hubspot?: boolean;
};

type PerResult = {
  id: string;
  contact_name: string;
  company_name: string | null;
  status: "scored" | "no_company" | "error";
  fit_score?: number;
  fit_action?: string;
  hubspot_sync?: "ok" | "error" | "skipped";
  hubspot_error?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.min(Math.max(1, body.batch_limit ?? DEFAULT_LIMIT), 100);
  const resyncHubspot = body.resync_hubspot !== false;

  const db = supabaseAdmin();

  // Selección: contactos sin fit_score, no descartados, con empresa
  // asociada. Priorizamos los que están en HubSpot (más urgente que
  // entren a las listas) y los que están en Lemlist (outreach activo).
  const { data: rows, error: rowsErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
        "seniority, hubspot_contact_id, lemlist_pushed_at"
    )
    .is("fit_score", null)
    .neq("status", "discarded")
    .not("company_id", "is", null)
    .order("hubspot_contact_id", { ascending: false, nullsFirst: false })
    .order("lemlist_pushed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  const contacts = (rows ?? []) as any[];

  if (contacts.length === 0) {
    return NextResponse.json({
      summary: { processed: 0, scored: 0, errors: 0, hubspot_synced: 0 },
      results: []
    });
  }

  // Empresas en una sola query.
  const companyIds = Array.from(new Set(contacts.map((c) => c.company_id)));
  const { data: companiesRaw } = await db
    .from("companies")
    .select(
      "id, company_name, company_type, company_size, cad_software, scanner_technology, fit_signals"
    )
    .in("id", companyIds);
  const companyById = new Map<string, any>();
  for (const co of (companiesRaw ?? []) as any[]) companyById.set(co.id, co);

  // Total remaining para que la UI sepa si hay que repetir.
  const { count: remainingTotal } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .is("fit_score", null)
    .neq("status", "discarded")
    .not("company_id", "is", null);

  const results: PerResult[] = [];
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const chunk = contacts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (c): Promise<PerResult> => {
        const fullName =
          [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)";
        const company = companyById.get(c.company_id);
        if (!company) {
          return {
            id: c.id,
            contact_name: fullName,
            company_name: null,
            status: "no_company"
          };
        }

        const input: ScoreInput = {
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          linkedin_headline: c.linkedin_headline,
          seniority: c.seniority,
          company_name: company.company_name,
          company_type: company.company_type,
          company_size: company.company_size,
          cad_software: company.cad_software,
          scanner_technology: company.scanner_technology,
          fit_signals: company.fit_signals
        };

        let scored;
        try {
          scored = await computeContactFitScore(input);
        } catch (err) {
          return {
            id: c.id,
            contact_name: fullName,
            company_name: company.company_name,
            status: "error",
            error: err instanceof Error ? err.message : "score failed"
          };
        }

        await db
          .from("contacts")
          .update({
            fit_score: scored.fit_score,
            fit: scored.fit,
            fit_reason: scored.fit_reason,
            // Solo seteamos fit_action si está null (no pisamos los que
            // ya vienen de Clay con su propio veredicto).
            // Esto se hace con un UPDATE condicional aparte abajo si hace falta.
            updated_at: new Date().toISOString()
          })
          .eq("id", c.id);

        // Si el contacto NO tiene fit_action seteado, lo seteamos también.
        // Esto es separado para no pisar el de Clay accidentalmente.
        await db
          .from("contacts")
          .update({ fit_action: scored.fit_action })
          .eq("id", c.id)
          .is("fit_action", null);

        const result: PerResult = {
          id: c.id,
          contact_name: fullName,
          company_name: company.company_name,
          status: "scored",
          fit_score: scored.fit_score,
          fit_action: scored.fit_action,
          hubspot_sync: "skipped"
        };

        // Re-sync a HubSpot si está sincronizado.
        if (resyncHubspot && c.hubspot_contact_id) {
          try {
            const hs = await syncContactToHubSpot(db, c.id);
            if (hs.ok) result.hubspot_sync = "ok";
            else {
              result.hubspot_sync = "error";
              result.hubspot_error = hs.error;
            }
          } catch (err) {
            result.hubspot_sync = "error";
            result.hubspot_error = err instanceof Error ? err.message : "sync failed";
          }
        }

        return result;
      })
    );
    results.push(...chunkResults);
  }

  const summary = {
    processed: results.length,
    scored: results.filter((r) => r.status === "scored").length,
    no_company: results.filter((r) => r.status === "no_company").length,
    errors: results.filter((r) => r.status === "error").length,
    hubspot_synced: results.filter((r) => r.hubspot_sync === "ok").length,
    hubspot_errors: results.filter((r) => r.hubspot_sync === "error").length,
    remaining_in_queue: Math.max(0, (remainingTotal ?? 0) - results.length)
  };

  return NextResponse.json({ summary, results });
}
