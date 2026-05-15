import { NextResponse } from "next/server";
import { getCampaignLeads } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sales-navigator/staged-leads
//
// Devuelve los leads que están actualmente en la Campaña puente de Lemlist
// (LEMLIST_STAGING_CAMPAIGN_ID). Lo usa la UI del módulo Sales Navigator
// para mostrar el preview con checkboxes — el usuario elige cuáles
// importar a la empresa de la card desde la que abrió el preview.
//
// La Campaña puente es compartida entre todas las empresas (es el "buzón"
// que llena la extensión de Lemlist desde Sales Navigator), así que este
// endpoint no toma company id.
export async function GET() {
  const stagingId = process.env.LEMLIST_STAGING_CAMPAIGN_ID;
  if (!stagingId) {
    return NextResponse.json(
      {
        error:
          "Falta LEMLIST_STAGING_CAMPAIGN_ID en Vercel — es el ID de la campaña puente de Lemlist."
      },
      { status: 500 }
    );
  }

  const leadsRes = await getCampaignLeads(stagingId);
  if (!leadsRes.ok) {
    return NextResponse.json(
      {
        error: `No se pudieron leer los leads de la campaña puente: ${leadsRes.error}`,
        debug: leadsRes.debug
      },
      { status: 502 }
    );
  }

  const leads = leadsRes.leads.map((l) => ({
    id: l.id,
    name: [l.first_name, l.last_name].filter(Boolean).join(" ") || null,
    first_name: l.first_name,
    last_name: l.last_name,
    company_name: l.company_name,
    job_title: l.job_title,
    linkedin_url: l.linkedin_url,
    email: l.email
  }));

  return NextResponse.json({
    ok: true,
    leads,
    staged_total: leads.length,
    matched_url: leadsRes.matched_url
  });
}
