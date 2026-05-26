import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipo de llamada devuelto por la API
export type CallRow = {
  id: string;
  client_id: string | null;
  hubspot_call_id: string;
  contact_name: string | null;
  company_name: string | null;
  direction: "OUTBOUND" | "INBOUND" | null;
  duration_ms: number | null;
  disposition: string | null;
  disposition_label: string | null;
  notes_raw: string | null;
  notes_clean: string | null;
  called_at: string | null;
  hubspot_owner_id: string | null;
  sdr_name: string | null;
  ai_score: number | null;
  ai_outcome: string | null;
  ai_outcome_detail: string | null;
  ai_is_real_conversation: boolean | null;
  ai_summary: string | null;
  ai_next_steps: string | null;
  analyzed_at: string | null;
  created_at: string;
};

// GET — Lee llamadas desde Supabase con filtros opcionales
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  const outcome = searchParams.get("outcome");
  const sdrName = searchParams.get("sdr_name");
  const limit = parseInt(searchParams.get("limit") ?? "100", 10);

  if (!clientId) {
    return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  let query = db
    .from("calls")
    .select("*")
    .eq("client_id", clientId)
    .order("called_at", { ascending: false })
    .limit(limit);

  if (outcome) {
    query = query.eq("ai_outcome", outcome);
  }
  if (sdrName) {
    query = query.eq("sdr_name", sdrName);
  }

  const { data: calls, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: `Error consultando llamadas: ${error.message}` },
      { status: 500 }
    );
  }

  const list: CallRow[] = calls ?? [];

  // Calcular estadísticas
  const total = list.length;
  const withDuration = list.filter((c) => (c.duration_ms ?? 0) > 0);
  const avgDurationMs =
    withDuration.length > 0
      ? Math.round(
          withDuration.reduce((acc, c) => acc + (c.duration_ms ?? 0), 0) /
            withDuration.length
        )
      : 0;

  const withScore = list.filter((c) => c.ai_score != null);
  const avgScore =
    withScore.length > 0
      ? Math.round(
          (withScore.reduce((acc, c) => acc + (c.ai_score ?? 0), 0) /
            withScore.length) *
            10
        ) / 10
      : 0;

  const realConversations = list.filter(
    (c) => c.ai_is_real_conversation === true
  ).length;
  const interested = list.filter((c) => c.ai_outcome === "Interesado").length;
  const analyzedCount = list.filter((c) => c.analyzed_at != null).length;

  // Contactos y empresas únicas
  const uniqueContacts = new Set(
    list.map((c) => c.contact_name).filter(Boolean)
  ).size;
  const uniqueCompanies = new Set(
    list.map((c) => c.company_name).filter(Boolean)
  ).size;

  // Outcomes y SDRs únicos para los filtros
  const outcomes = [
    ...new Set(list.map((c) => c.ai_outcome).filter(Boolean) as string[]),
  ].sort();
  const sdrNames = [
    ...new Set(list.map((c) => c.sdr_name).filter(Boolean) as string[]),
  ].sort();

  const stats = {
    total,
    avg_duration_ms: avgDurationMs,
    avg_score: avgScore,
    real_conversations: realConversations,
    interested,
    unique_contacts: uniqueContacts,
    unique_companies: uniqueCompanies,
    analyzed_count: analyzedCount,
  };

  return NextResponse.json({ calls: list, stats, outcomes, sdr_names: sdrNames });
}
