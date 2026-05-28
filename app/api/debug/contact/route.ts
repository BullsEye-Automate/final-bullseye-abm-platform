import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

// GET /api/debug/contact?email=xxx@yyy.com  OR  ?name=Carolina+Anguita
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const name  = req.nextUrl.searchParams.get("name");
  if (!email && !name) return NextResponse.json({ error: "Falta ?email= o ?name=" }, { status: 400 });

  const db = supabaseAdmin();

  // 1. Contacto en Supabase (por email o por nombre)
  let contact: Record<string, unknown> | null = null;
  if (email) {
    const { data } = await db
      .from("contacts")
      .select("id, first_name, last_name, job_title, email, phone, phone_source, linkedin_url, linkedin_headline, email_subject, email_body, linkedin_icebreaker, fit_score, status, seniority, lemlist_pushed_at, client_id, company_id, fit_action")
      .eq("email", email)
      .maybeSingle();
    contact = data;
  }

  // Si no encontró por email, buscar por nombre
  if (!contact && name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0] ?? "";
    const last  = parts.slice(1).join(" ") || null;
    let q = db.from("contacts")
      .select("id, first_name, last_name, job_title, email, phone, phone_source, linkedin_url, linkedin_headline, email_subject, email_body, linkedin_icebreaker, fit_score, status, seniority, lemlist_pushed_at, client_id, company_id, fit_action")
      .ilike("first_name", `%${first}%`);
    if (last) q = q.ilike("last_name", `%${last}%`);
    const { data } = await q.limit(5);
    contact = (data && data.length > 0) ? { multiple: data } as unknown as Record<string, unknown> : null;
  }

  // 2. Contacto en HubSpot
  const hsQuery = email
    ? { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }] }
    : { filterGroups: [{ filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: name!.split(" ")[0] }] }] };

  const hsSearch = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...hsQuery,
      properties: [
        "email", "firstname", "lastname", "jobtitle", "phone",
        "bullseye_contact_id", "bullseye_email_subject", "bullseye_email_body",
        "bullseye_linkedin_icebreaker", "bullseye_fit_score", "bullseye_engagement_score",
        "bullseye_status", "bullseye_linkedin_headline", "bullseye_script_sdr_ia",
        "bullseye_lemlist_campaign_id", "bullseye_telefono_lusha", "bullseye_phone_source",
      ],
      limit: 3,
    }),
  });

  let hubspot: Record<string, unknown> | null = null;
  if (hsSearch.ok) {
    const data = await hsSearch.json();
    hubspot = data.results?.length === 1 ? data.results[0] : (data.results ?? null);
  } else {
    const txt = await hsSearch.text().catch(() => "");
    hubspot = { error: `${hsSearch.status}: ${txt.slice(0, 300)}` };
  }

  return NextResponse.json({ supabase: contact ?? null, hubspot }, { status: 200 });
}
