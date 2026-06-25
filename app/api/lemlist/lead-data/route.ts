import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/lemlist/lead-data?client_id=X&email=Y
// Obtiene datos del lead en Lemlist por email (teléfono, empresa, etc.)
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const email    = req.nextUrl.searchParams.get("email");

  if (!clientId || !email) {
    return NextResponse.json({ error: "Se requiere client_id y email" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, clientId);
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const { data: config } = await db
    .from("client_configs").select("lemlist_campaign_id").eq("client_id", clientId).maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ found: false });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  try {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    );

    if (!res.ok) return NextResponse.json({ found: false });

    const lead = await res.json();
    return NextResponse.json({
      found:        true,
      phone:        lead.phone?.trim() || lead.phoneNumber?.trim() || null,
      company_name: lead.companyName ?? lead.company ?? lead.organizationName ?? null,
      linkedin_url: lead.linkedinUrl ?? lead.linkedin ?? null,
      first_name:   lead.firstName ?? null,
      last_name:    lead.lastName  ?? null,
      job_title:    lead.jobTitle  ?? lead.title ?? null,
    });
  } catch {
    return NextResponse.json({ found: false });
  }
}
