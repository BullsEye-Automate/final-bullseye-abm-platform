import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

// GET /api/debug/contact?email=xxx@yyy.com
// Devuelve el estado del contacto en nuestra BD y en HubSpot
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Falta ?email=" }, { status: 400 });

  const db = supabaseAdmin();

  // 1. Contacto en Supabase
  const { data: contact } = await db
    .from("contacts")
    .select("id, first_name, last_name, job_title, email, phone, phone_source, linkedin_url, linkedin_headline, email_subject, email_body, linkedin_icebreaker, fit_score, status, seniority, lemlist_pushed_at, client_id, company_id, fit_action")
    .eq("email", email)
    .maybeSingle();

  // 2. Contacto en HubSpot por email
  const hsSearch = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: [
        "email", "firstname", "lastname", "jobtitle", "phone",
        "bullseye_contact_id", "bullseye_email_subject", "bullseye_email_body",
        "bullseye_linkedin_icebreaker", "bullseye_fit_score", "bullseye_engagement_score",
        "bullseye_status", "bullseye_linkedin_headline", "bullseye_script_sdr_ia",
        "bullseye_lemlist_campaign_id", "bullseye_telefono_lusha", "bullseye_phone_source",
      ],
      limit: 1,
    }),
  });

  let hubspot: Record<string, unknown> | null = null;
  if (hsSearch.ok) {
    const data = await hsSearch.json();
    hubspot = data.results?.[0] ?? null;
  } else {
    const txt = await hsSearch.text().catch(() => "");
    hubspot = { error: `${hsSearch.status}: ${txt.slice(0, 300)}` };
  }

  return NextResponse.json({ supabase: contact ?? null, hubspot }, { status: 200 });
}
