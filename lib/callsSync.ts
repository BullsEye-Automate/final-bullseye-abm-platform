// Sync HubSpot → Supabase de llamadas. Sprint 5 fase 2.
//
// Patrón:
//   1. searchCallsSince(sinceMs) — devuelve calls posteriores a la fecha.
//   2. batchReadCallAssociations — re-fetch para traer contacts/companies
//      asociados (la search API no los expone).
//   3. Resolver disposition_id → label vía /properties/calls.
//   4. Resolver hubspot_owner_id → owner_name vía /owners.
//   5. Resolver hubspot_contact_id / hubspot_company_id → contacts.id /
//      companies.id en Supabase (left join por hubspot_*_id).
//   6. Upsert sobre calls.hubspot_call_id.
//   7. Para los recién insertados sin transcripción analizada todavía,
//      disparar analyzeCall en serie (best effort, no bloquea el sync).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchCallsSince,
  batchReadCallAssociations,
  getDispositionMap,
  getOwnerMap,
  type HubSpotCall
} from "./hubspotCalls";
import { analyzeCall } from "./callAnalyzer";

export type SyncCallsResult = {
  ok: boolean;
  scanned: number;
  upserted: number;
  analyzed: number;
  failed_analysis: number;
  errors: Array<{ stage: string; message: string; debug?: unknown }>;
};

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function asNumberOrNull(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function asTimestampOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  // HubSpot manda epoch ms como string o ISO. Probamos ambos.
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Procesa un conjunto de hubspot_call_ids: trae detail con associations,
// resuelve dispositions + owners + FKs Supabase, y upsertea en la tabla
// calls. Usado por syncCalls (batch desde search) y por el webhook real-time.
export async function processCallIds(
  db: SupabaseClient,
  callIds: string[]
): Promise<{
  ok: boolean;
  upserted: number;
  upserted_ids: string[];
  errors: Array<{ stage: string; message: string; debug?: unknown }>;
}> {
  const out = { ok: true, upserted: 0, upserted_ids: [] as string[], errors: [] as Array<{ stage: string; message: string; debug?: unknown }> };
  if (callIds.length === 0) return out;

  const assocRes = await batchReadCallAssociations(callIds);
  if (!assocRes.ok) {
    out.ok = false;
    out.errors.push({ stage: "associations", message: assocRes.error, debug: assocRes.debug });
    return out;
  }
  const callsWithAssoc: HubSpotCall[] = assocRes.data;

  const [dispRes, ownerRes] = await Promise.all([getDispositionMap(), getOwnerMap()]);
  const dispositionMap = dispRes.ok ? dispRes.data : {};
  const ownerMap = ownerRes.ok ? ownerRes.data : {};

  const hsContactIds = new Set<string>();
  const hsCompanyIds = new Set<string>();
  for (const c of callsWithAssoc) {
    const ct = c.associations?.contacts?.results?.[0]?.id;
    const co = c.associations?.companies?.results?.[0]?.id;
    if (ct) hsContactIds.add(ct);
    if (co) hsCompanyIds.add(co);
  }
  const contactMap: Record<string, string> = {};
  const companyMap: Record<string, string> = {};
  if (hsContactIds.size > 0) {
    const { data } = await db
      .from("contacts")
      .select("id, hubspot_contact_id")
      .in("hubspot_contact_id", Array.from(hsContactIds));
    for (const row of (data ?? []) as Array<{ id: string; hubspot_contact_id: string | null }>) {
      if (row.hubspot_contact_id) contactMap[row.hubspot_contact_id] = row.id;
    }
  }
  if (hsCompanyIds.size > 0) {
    const { data } = await db
      .from("companies")
      .select("id, hubspot_company_id")
      .in("hubspot_company_id", Array.from(hsCompanyIds));
    for (const row of (data ?? []) as Array<{ id: string; hubspot_company_id: string | null }>) {
      if (row.hubspot_company_id) companyMap[row.hubspot_company_id] = row.id;
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const c of callsWithAssoc) {
    const p = c.properties ?? {};
    const hsContactId = c.associations?.contacts?.results?.[0]?.id ?? null;
    const hsCompanyId = c.associations?.companies?.results?.[0]?.id ?? null;
    const ownerId = p.hubspot_owner_id ?? null;
    const dispId = p.hs_call_disposition ?? null;

    rows.push({
      hubspot_call_id: c.id,
      hubspot_contact_id: hsContactId,
      hubspot_company_id: hsCompanyId,
      hubspot_owner_id: ownerId ?? null,
      owner_name: ownerId && ownerMap[ownerId] ? ownerMap[ownerId] : null,
      contact_id: hsContactId ? contactMap[hsContactId] ?? null : null,
      company_id: hsCompanyId ? companyMap[hsCompanyId] ?? null : null,
      call_timestamp: asTimestampOrNull(p.hs_timestamp),
      direction: p.hs_call_direction ?? null,
      duration_ms: asNumberOrNull(p.hs_call_duration),
      disposition_id: dispId ?? null,
      disposition_label: dispId && dispositionMap[dispId] ? dispositionMap[dispId] : null,
      status: p.hs_call_status ?? null,
      call_title: p.hs_call_title ?? null,
      body: stripHtml(p.hs_call_body) || null,
      recording_url: p.hs_call_recording_url ?? null,
      transcription: p.hs_call_transcription ?? null,
      has_transcription: !!(p.hs_call_transcription && String(p.hs_call_transcription).trim())
    });
  }

  const { error: upsertErr } = await db
    .from("calls")
    .upsert(rows, { onConflict: "hubspot_call_id", ignoreDuplicates: false });
  if (upsertErr) {
    out.ok = false;
    out.errors.push({ stage: "upsert", message: upsertErr.message });
    return out;
  }
  out.upserted = rows.length;
  out.upserted_ids = rows.map((r) => r.hubspot_call_id as string);
  return out;
}

export async function syncCalls(
  db: SupabaseClient,
  options: { sinceDays?: number; maxResults?: number; analyze?: boolean } = {}
): Promise<SyncCallsResult> {
  const sinceDays = options.sinceDays ?? 30;
  const maxResults = options.maxResults ?? 200;
  const analyze = options.analyze !== false;

  const result: SyncCallsResult = {
    ok: true,
    scanned: 0,
    upserted: 0,
    analyzed: 0,
    failed_analysis: 0,
    errors: []
  };

  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const searchRes = await searchCallsSince(sinceMs, maxResults);
  if (!searchRes.ok) {
    result.ok = false;
    result.errors.push({ stage: "search", message: searchRes.error, debug: searchRes.debug });
    return result;
  }
  result.scanned = searchRes.data.length;
  if (searchRes.data.length === 0) return result;

  const callIds = searchRes.data.map((c) => c.id);
  const processed = await processCallIds(db, callIds);
  result.upserted = processed.upserted;
  result.errors.push(...processed.errors);
  if (!processed.ok) {
    result.ok = false;
    return result;
  }

  if (!analyze) return result;

  type PendingCall = {
    id: string;
    transcription: string | null;
    body: string | null;
    direction: string | null;
    duration_ms: number | null;
    disposition_label: string | null;
    status: string | null;
    owner_name: string | null;
    contact_id: string | null;
    company_id: string | null;
    has_transcription: boolean;
  };

  // Analizar las que no tienen análisis todavía. Tomamos los hubspot_call_id
  // que acabamos de upsertear y filtramos los analyzed_at IS NULL.
  const { data: pendingRaw } = await db
    .from("calls")
    .select(
      "id, transcription, body, direction, duration_ms, disposition_label, status, " +
        "owner_name, contact_id, company_id, has_transcription"
    )
    .in("hubspot_call_id", processed.upserted_ids)
    .is("analyzed_at", null);
  const pending = (pendingRaw ?? []) as unknown as PendingCall[];

  for (const callRow of pending) {
    try {
      let contactName: string | null = null;
      let contactTitle: string | null = null;
      let companyName: string | null = null;
      let companyType: string | null = null;
      let companySize: number | null = null;
      let cadSoftware: string | null = null;

      if (callRow.contact_id) {
        const { data: cntRaw } = await db
          .from("contacts")
          .select("first_name, last_name, job_title")
          .eq("id", callRow.contact_id)
          .maybeSingle();
        const cnt = cntRaw as { first_name: string | null; last_name: string | null; job_title: string | null } | null;
        if (cnt) {
          contactName = [cnt.first_name, cnt.last_name].filter(Boolean).join(" ") || null;
          contactTitle = cnt.job_title ?? null;
        }
      }
      if (callRow.company_id) {
        const { data: cmpRaw } = await db
          .from("companies")
          .select("company_name, company_type, company_size, cad_software")
          .eq("id", callRow.company_id)
          .maybeSingle();
        const cmp = cmpRaw as
          | { company_name: string | null; company_type: string | null; company_size: number | null; cad_software: string | null }
          | null;
        if (cmp) {
          companyName = cmp.company_name ?? null;
          companyType = cmp.company_type ?? null;
          companySize = cmp.company_size ?? null;
          cadSoftware = cmp.cad_software ?? null;
        }
      }

      const analysis = await analyzeCall({
        contact_name: contactName,
        contact_title: contactTitle,
        company_name: companyName,
        company_type: companyType,
        company_size: companySize,
        cad_software: cadSoftware,
        sdr_name: callRow.owner_name,
        direction: callRow.direction,
        duration_sec:
          callRow.duration_ms != null ? Math.round(Number(callRow.duration_ms) / 1000) : null,
        disposition_label: callRow.disposition_label,
        status: callRow.status,
        transcription: callRow.transcription,
        notes: callRow.body
      });

      await db
        .from("calls")
        .update({
          analyzed_at: new Date().toISOString(),
          analysis_model: analysis.model_used,
          analysis_error: null,
          customer_response_category: analysis.customer_response.category,
          customer_response_label: analysis.customer_response.label,
          customer_response_summary: analysis.customer_response.summary,
          sdr_score_overall: analysis.sdr_evaluation.overall_score,
          sdr_score_opening: analysis.sdr_evaluation.opening,
          sdr_score_discovery: analysis.sdr_evaluation.discovery,
          sdr_score_objection: analysis.sdr_evaluation.objection_handling,
          sdr_score_next_step: analysis.sdr_evaluation.next_step,
          sdr_strengths: analysis.sdr_evaluation.strengths,
          sdr_improvements: analysis.sdr_evaluation.improvements,
          recommended_next_step: analysis.recommended_next_step
        })
        .eq("id", callRow.id);
      result.analyzed++;
    } catch (err) {
      result.failed_analysis++;
      const msg = err instanceof Error ? err.message : "Analyze error";
      await db.from("calls").update({ analysis_error: msg }).eq("id", callRow.id);
      result.errors.push({ stage: "analyze", message: msg });
    }
  }

  return result;
}
