import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncLemlistActivities } from "@/lib/lemlistActivities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s: paginar todas las actividades de la campaña puede ser varias páginas.
export const maxDuration = 300;

// POST /api/lemlist/sync-activities
//
// Pullea el feed de actividades de la campaña de Lemlist (LEMLIST_CAMPAIGN_ID),
// matchea cada evento a un contacto por email y lo upsertea en
// lemlist_activities. Lo dispara el botón "Sincronizar con Lemlist" del
// módulo /campanas. Idempotente.
export async function POST() {
  const db = supabaseAdmin();
  const result = await syncLemlistActivities(db);
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
