import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getAllCampaignsLeads } from "@/lib/lemlist";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Reporte de todos los contactos que entraron a CUALQUIER campaña de Lemlist
// del workspace del cliente (no solo la campaña principal configurada),
// filtrado por fecha de ingreso. Ver lib/lemlist.ts: getAllCampaignsLeads.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId || clientId === "__all__") {
    return NextResponse.json(
      { error: "Selecciona un cliente específico (este reporte no soporta \"todos los clientes\")" },
      { status: 400 }
    );
  }

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "";
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) {
    return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 400 });
  }

  try {
    const { campaigns, leads } = await getAllCampaignsLeads(apiKey);

    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const inRange = leads.filter((l) => {
      if (!l.added_at) return false;
      const t = new Date(l.added_at).getTime();
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    });

    const uniqueContacts = new Set(inRange.map((l) => l.contact_id ?? l.email ?? l.id));
    const uniqueCompanies = new Set(
      inRange.map((l) => l.company_name).filter(Boolean).map((c) => c.trim().toLowerCase())
    );
    const campaignsWithActivity = new Set(inRange.map((l) => l.campaign_id));

    return NextResponse.json({
      range: { key, start: range.start, end: range.end, label: range.label },
      campaigns,
      leads: inRange,
      stats: {
        contactos: uniqueContacts.size,
        empresas: uniqueCompanies.size,
        campanas_con_actividad: campaignsWithActivity.size,
        campanas_total: campaigns.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Lemlist" }, { status: 500 });
  }
}
