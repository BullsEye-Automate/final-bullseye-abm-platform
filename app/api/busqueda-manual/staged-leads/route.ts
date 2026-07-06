import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getClientLemlistConfig, getCampaignLeadsWithDetails } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Leads actuales de la Campaña puente del cliente activo, sin importar.
// Usado por el preview con checkboxes de la cola de Clay (Parte 2).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();

  const config = await getClientLemlistConfig(db, clientId);
  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) {
    return NextResponse.json({ error: "No hay Campaña puente configurada para este cliente. Agregala en Config. cliente." }, { status: 400 });
  }

  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 500 });

  const result = await getCampaignLeadsWithDetails(stagingId, apiKey);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({
    leads: result.leads.map((l) => ({
      id: l.id,
      name: `${l.first_name} ${l.last_name}`.trim() || l.email || l.linkedin_url || "Sin nombre",
      first_name: l.first_name,
      last_name: l.last_name,
      company_name: l.company_name,
      job_title: l.job_title,
      linkedin_url: l.linkedin_url,
      email: l.email,
    })),
    staged_total: result.leads.length,
    matched_url: result.matched_url,
  });
}
