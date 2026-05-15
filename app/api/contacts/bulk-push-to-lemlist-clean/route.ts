// Push limpio de contactos a Lemlist — sin DELETE, sin lookup, sin
// snapshots. Solo ADD.
//
// Disparador: el bulk-regenerate-messages quedó pegado intentando hacer
// DELETE de leads que solo Lemlist conoce internamente. La API de leads
// devuelve metadata mínima y la enumeración por _id no resuelve el
// matching contra nuestros contactos.
//
// Plan operativo "clean slate":
//   1. El usuario va a Lemlist UI → selecciona todos los leads → bulk
//      delete. La campaña queda vacía.
//   2. Este endpoint empuja a Lemlist TODOS los contactos que deberían
//      estar ahí (approved + con mensajes generados). Como la campaña
//      está vacía, ningún ADD falla por duplicate.
//   3. El usuario re-activa Lemlist.
//
// Selecciona contactos:
//   - linkedin_icebreaker IS NOT NULL (ya tienen mensajes, no hay que
//     generar nada).
//   - human_decision = 'approved' OR fit_action = 'enrich' (passed el
//     pre-filtro y human review).
//   - status != 'discarded'.
//
// Procesamiento: paralelo en chunks de 3, cap de 25 por request (cada
// ADD a Lemlist toma ~5-10s; 25/3 = ~80s, holgado para 300s).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_LIMIT = 25;
const CONCURRENCY = 3;

type Body = {
  batch_limit?: number;
  // Si true, también pushea los que ya tienen lemlist_pushed_at != null.
  // Default false: asume que el usuario limpió Lemlist UI, así que solo
  // pushea los que están marcados como ya empujados (todos).
  // En realidad para el clean slate queremos pushear TODOS los que
  // deberían estar en Lemlist, así que default es true.
  include_already_pushed?: boolean;
};

type ContactRow = {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  seniority: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
  lemlist_pushed_at: string | null;
  human_decision: string | null;
  fit_action: string | null;
};

type CompanyRow = {
  id: string;
  company_name: string | null;
  company_size: number | null;
  company_type: string | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
};

type PerResult = {
  id: string;
  contact_name: string;
  company_name: string | null;
  status: "pushed" | "error" | "no_company";
  error?: string;
  debug?: unknown;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.min(Math.max(1, body.batch_limit ?? DEFAULT_LIMIT), 50);

  const db = supabaseAdmin();

  // Selección: contactos con mensajes generados + aprobados.
  const { data: rows, error: rowsErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, fit_score, fit_reason, linkedin_icebreaker, email_subject, email_body, lemlist_pushed_at, human_decision, fit_action, status"
    )
    .not("linkedin_icebreaker", "is", null)
    .neq("status", "discarded")
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const all = (rows ?? []) as (ContactRow & { status: string })[];
  // Filtro: aprobados o enrich. Excluir status=discarded ya viene del query.
  const filtered = all.filter(
    (c) => c.human_decision === "approved" || c.fit_action === "enrich"
  );
  const batch = filtered.slice(0, limit);

  if (batch.length === 0) {
    return NextResponse.json({
      summary: {
        processed: 0,
        pushed: 0,
        errors: 0,
        no_company: 0,
        remaining_in_queue: 0
      },
      results: []
    });
  }

  // Traemos las empresas asociadas en una sola query.
  const companyIds = Array.from(new Set(batch.map((c) => c.company_id)));
  const { data: companyRows, error: cErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_size, company_type, cad_software, scanner_technology, fit_signals"
    )
    .in("id", companyIds);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const companyById = new Map<string, CompanyRow>();
  for (const c of (companyRows ?? []) as CompanyRow[]) companyById.set(c.id, c);

  const results: PerResult[] = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const chunkResults: PerResult[] = await Promise.all(
      chunk.map(async (ct): Promise<PerResult> => {
        const fullName =
          [ct.first_name, ct.last_name].filter(Boolean).join(" ").trim() || "(sin nombre)";
        const company = companyById.get(ct.company_id) ?? null;
        if (!company) {
          return {
            id: ct.id,
            contact_name: fullName,
            company_name: null,
            status: "no_company"
          };
        }
        // Limpiamos lemlist_pushed_at antes para que pushApprovedToLemlist
        // siempre opere igual y no asuma que ya fue pusheado.
        await db
          .from("contacts")
          .update({ lemlist_pushed_at: null, lemlist_push_error: null })
          .eq("id", ct.id);

        const res = await pushApprovedToLemlist(
          db,
          ct.id,
          {
            first_name: ct.first_name,
            last_name: ct.last_name,
            job_title: ct.job_title,
            linkedin_headline: ct.linkedin_headline,
            linkedin_url: ct.linkedin_url,
            email: ct.email,
            phone: ct.phone,
            seniority: ct.seniority,
            fit_score: ct.fit_score,
            fit_reason: ct.fit_reason,
            linkedin_icebreaker: ct.linkedin_icebreaker,
            email_subject: ct.email_subject,
            email_body: ct.email_body
          },
          {
            company_name: company.company_name,
            company_size: company.company_size,
            company_type: company.company_type,
            cad_software: company.cad_software,
            scanner_technology: company.scanner_technology,
            fit_signals: company.fit_signals
          }
        );

        if (res.ok) {
          return {
            id: ct.id,
            contact_name: fullName,
            company_name: company.company_name,
            status: "pushed"
          };
        }
        return {
          id: ct.id,
          contact_name: fullName,
          company_name: company.company_name,
          status: "error",
          error: res.error,
          debug: (res as any).debug
        };
      })
    );
    results.push(...chunkResults);
  }

  const remaining = Math.max(0, filtered.length - batch.length);
  const summary = {
    processed: results.length,
    pushed: results.filter((r) => r.status === "pushed").length,
    errors: results.filter((r) => r.status === "error").length,
    no_company: results.filter((r) => r.status === "no_company").length,
    remaining_in_queue: remaining
  };

  return NextResponse.json({ summary, results });
}
