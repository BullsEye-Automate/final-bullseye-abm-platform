import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchAlloCalls } from "@/lib/allo";
import { callDateKey } from "@/lib/sdrAnalytics";
import { parseCallScoreCard } from "@/lib/callScoreCard";

// Endpoint de diagnóstico TEMPORAL — el usuario reporta 255 llamadas "Hoy"
// pero solo 14 con score de IA, tras configurar ayer que Allo analice TODAS
// las llamadas. Este endpoint replica el mismo fetch+filtro que
// /api/analisis/scores para "Hoy" y clasifica cada llamada: con score,
// summary corto (sin análisis rico), o sin summary — reportando cuán
// reciente es cada una, para distinguir "aún no procesada por Allo" de
// "Allo no le generó el análisis". Se borra apenas se obtenga la respuesta.

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id") || "__all__";
    const isAllClients = clientId === "__all__";

    const db = supabaseAdmin();
    let assignedQuery = db.from("client_allo_numbers").select("allo_number");
    if (!isAllClients) assignedQuery = assignedQuery.eq("client_id", clientId);
    const { data: assigned, error: assignedErr } = await assignedQuery;
    if (assignedErr) return NextResponse.json({ error: assignedErr.message }, { status: 500 });

    const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);
    if (assignedNumbers.length === 0) return NextResponse.json({ ok: true, note: "sin números asignados" });

    const now = new Date();
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = dateFrom;

    const callsByNumber = await Promise.all(
      assignedNumbers.map((n) =>
        searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
      )
    );

    const seen = new Set<string>();
    const calls = callsByNumber.flat().filter((c) => {
      if (!assignedNumbers.includes(c.allo_number)) return false;
      const key = callDateKey(c.date);
      if (key < dateFrom || key > dateTo) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const nowMs = now.getTime();
    const withCard: any[] = [];
    const shortSummary: any[] = [];
    const noSummary: any[] = [];

    for (const c of calls) {
      const minsAgo = Math.round((nowMs - new Date(c.date).getTime()) / 60000);
      const card = parseCallScoreCard(c.summary);
      if (card) {
        withCard.push({ id: c.id, date: c.date, minsAgo, puntajeTotal: card.puntajeTotal });
      } else if (!c.summary) {
        noSummary.push({ id: c.id, date: c.date, minsAgo, duration: c.duration, result: c.result });
      } else {
        shortSummary.push({
          id: c.id,
          date: c.date,
          minsAgo,
          duration: c.duration,
          result: c.result,
          summaryPreview: c.summary.slice(0, 200),
          summaryLength: c.summary.length,
        });
      }
    }

    shortSummary.sort((a, b) => a.minsAgo - b.minsAgo);
    noSummary.sort((a, b) => a.minsAgo - b.minsAgo);

    return NextResponse.json({
      ok: true,
      now: now.toISOString(),
      total_calls_hoy: calls.length,
      con_score: withCard.length,
      con_summary_corto: shortSummary.length,
      sin_summary: noSummary.length,
      muestra_summary_corto: shortSummary.slice(0, 15),
      muestra_sin_summary: noSummary.slice(0, 15),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
