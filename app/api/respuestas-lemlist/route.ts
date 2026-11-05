import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentMode } from "@/lib/respuestasLemlist/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bandeja de respuestas de Lemlist (requiere sesión, ver middleware.ts).
// ?client_id= filtra por cliente; ?action= por acción; ?days= (por defecto 30).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(180, Math.max(1, Number(sp.get("days")) || 30));
  const db = supabaseAdmin();
  let q = db
    .from("lemlist_replies")
    .select("id, client_id, client_name, campaign_name, channel, lead_email, lead_name, company_name, reply_text, replied_at, category, confidence, summary, sdr_value, sdr_name, sdr_email, kam_email, action, action_detail, mode, hubspot_updated, lemlist_paused, notified_to, hs_contact_id, error, created_at")
    .gte("created_at", new Date(Date.now() - days * 86400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);
  const clientId = sp.get("client_id");
  if (clientId && clientId !== "__all__") q = q.eq("client_id", clientId);
  const action = sp.get("action");
  if (action) q = q.eq("action", action);
  const { data, error } = await q;
  if (error) {
    const hint = /does not exist|Could not find the table/i.test(error.message) ? "Falta ejecutar la migración supabase/20261105_lemlist_replies_migration.sql en Supabase." : error.message;
    return NextResponse.json({ error: hint }, { status: 500 });
  }
  return NextResponse.json({ mode: currentMode(), rows: data ?? [] });
}
