import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchAlloCalls, getAlloCallDetail, fetchAlloConnectedCallIds, resolveConnected } from "@/lib/allo";
import { searchHSContactsByPhones } from "@/lib/hubspot";
import { getClientModel } from "@/lib/claude";
import { analyzeCallTranscript, topRelevance } from "@/lib/alloCallSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Analiza con Claude las llamadas realmente conectadas (ver
// fetchAlloConnectedCallIds en lib/allo.ts) de los últimos días, para
// detectar señales comerciales (ciclos de presupuesto, procesos de compra,
// rechazos, empresas mencionadas, etc.) usando el ICP/propuesta de valor del
// cliente (client_ai_context) como contexto de evaluación.
//
// Ventana de 3 días en vez de solo "desde la última corrida": es idempotente
// por allo_call_id (índice único en allo_call_signals), así que repetir días
// ya analizados no duplica nada, pero sí nos protege de perder llamadas si
// una corrida falla o tarda en reflejarse en la API de Allo.
const LOOKBACK_DAYS = 3;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Módulo en pausa mientras no se use (consume IA en cada llamada conectada).
  // Para reactivarlo: setear ALLO_SIGNALS_ENABLED=true en Vercel.
  if (process.env.ALLO_SIGNALS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, paused: true });
  }

  const db = supabaseAdmin();
  const now = new Date();
  const dateFrom = toDateParam(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));
  const dateTo = toDateParam(now);

  const { data: assignments, error: assignErr } = await db
    .from("client_allo_numbers")
    .select("client_id, allo_number");
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  const numbersByClient = new Map<string, string[]>();
  for (const row of assignments ?? []) {
    const arr = numbersByClient.get(row.client_id) ?? [];
    arr.push(row.allo_number);
    numbersByClient.set(row.client_id, arr);
  }

  const summary: Record<string, { analyzed: number; skipped: number; errors: number }> = {};

  for (const [clientId, numbers] of numbersByClient) {
    const stats = { analyzed: 0, skipped: 0, errors: 0 };
    summary[clientId] = stats;

    try {
      const { data: ctxRows } = await db.from("client_ai_context").select("content").eq("client_id", clientId);
      const icpContext = (ctxRows ?? [])
        .map((r: { content: string | null }) => r.content)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (!icpContext.trim()) continue; // sin ICP/propuesta de valor no hay con qué evaluar fit

      const [callsByNumber, connectedIds] = await Promise.all([
        Promise.all(
          numbers.map((n) => searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" }))
        ),
        fetchAlloConnectedCallIds({ allo_numbers: numbers, date_from: dateFrom, date_to: dateTo }),
      ]);

      const seen = new Set<string>();
      const calls = callsByNumber.flat().filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return resolveConnected(c, connectedIds);
      });
      if (calls.length === 0) continue;

      const callIds = calls.map((c) => c.id);
      const { data: existing } = await db.from("allo_call_signals").select("allo_call_id").in("allo_call_id", callIds);
      const existingIds = new Set((existing ?? []).map((r: { allo_call_id: string }) => r.allo_call_id));
      const pending = calls.filter((c) => !existingIds.has(c.id));
      if (pending.length === 0) continue;

      const model = await getClientModel(db, clientId);
      const uniquePhones = Array.from(new Set(pending.map((c) => c.contact_number)));
      const hsMatches = await searchHSContactsByPhones(uniquePhones);

      for (const call of pending) {
        try {
          const detail = await getAlloCallDetail(call.id);
          const hs = hsMatches.get(call.contact_number);

          if (!detail.transcript || detail.transcript.length === 0) {
            // Igual se marca como procesada (allo_call_id único) para no
            // reintentar una llamada sin transcript en cada corrida.
            stats.skipped++;
            await db.from("allo_call_signals").insert({
              client_id: clientId,
              allo_call_id: call.id,
              allo_number: call.allo_number,
              contact_number: call.contact_number,
              contact_name: hs?.name ?? detail.extracted_contact.name,
              contact_company: hs?.company_name ?? detail.extracted_contact.company,
              contact_job_title: hs?.job_title ?? detail.extracted_contact.job_title,
              call_date: call.date,
              call_duration: call.duration,
              signals: [],
              mentioned_companies: [],
              top_relevance: null,
              recommended_action: "ninguna_accion",
              crm_summary: null,
            });
            continue;
          }

          const transcriptText = detail.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");
          const result = await analyzeCallTranscript(transcriptText, icpContext, model, clientId);
          const relevance = topRelevance(result.senales);

          await db.from("allo_call_signals").insert({
            client_id: clientId,
            allo_call_id: call.id,
            allo_number: call.allo_number,
            contact_number: call.contact_number,
            contact_name: hs?.name ?? detail.extracted_contact.name,
            contact_company: hs?.company_name ?? detail.extracted_contact.company ?? (result.empresa_prospecto || null),
            contact_job_title: hs?.job_title ?? detail.extracted_contact.job_title,
            call_date: call.date,
            call_duration: call.duration,
            model,
            signals: result.senales,
            mentioned_companies: result.empresas_mencionadas,
            mentioned_technologies: result.tecnologias_mencionadas,
            industry: result.industria_prospecto || null,
            top_relevance: relevance,
            recommended_action: result.accion_sugerida,
            follow_up_date: result.fecha_seguimiento || null,
            crm_summary: result.resumen_crm || null,
          });
          stats.analyzed++;
        } catch (err: any) {
          stats.errors++;
          console.error(`[analyze-allo-calls] Error en llamada ${call.id} (cliente ${clientId}):`, err?.message ?? err);
        }
      }
    } catch (err: any) {
      stats.errors++;
      console.error(`[analyze-allo-calls] Error procesando cliente ${clientId}:`, err?.message ?? err);
    }
  }

  return NextResponse.json({ ok: true, summary });
}
