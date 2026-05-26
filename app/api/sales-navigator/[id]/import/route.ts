import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const all = req.nextUrl.searchParams.get("all") === "1";
  const db  = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies").select("*").eq("id", params.id).single();
  if (compErr || !company) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_staging_campaign_id")
    .eq("client_id", company.client_id ?? "")
    .maybeSingle();

  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) {
    return NextResponse.json({ error: "No hay Campaña puente configurada. Agregala en Config. cliente." }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurada" }, { status: 500 });

  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${stagingId}/leads?limit=100`,
    { headers: { Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}` } }
  ).catch(() => null);

  if (!leadsRes?.ok) {
    const txt = await leadsRes?.text().catch(() => "");
    return NextResponse.json({ error: `Lemlist: ${leadsRes?.status} — ${txt}` }, { status: 502 });
  }

  const payload = await leadsRes.json().catch(() => ({}));
  const leads: Record<string, unknown>[] = payload.items ?? (Array.isArray(payload) ? payload : []);

  if (!leads.length) {
    return NextResponse.json({ staged_total: 0, staged_leads: [], matched_count: 0, imported: [], summary: { yes: 0, no: 0, skipped: 0 } });
  }

  const companyWords = (company.company_name as string)
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w: string) => w.length > 3);

  const matched = all
    ? leads
    : leads.filter(l => {
        const lc = ((l.companyName ?? l.company_name ?? "") as string).toLowerCase();
        return companyWords.some((w: string) => lc.includes(w));
      });

  const contacts = matched.map(l => ({
    first_name:   (l.firstName  ?? l.first_name  ?? null) as string | null,
    last_name:    (l.lastName   ?? l.last_name   ?? null) as string | null,
    job_title:    (l.jobTitle   ?? l.job_title   ?? null) as string | null,
    linkedin_url: (l.linkedinUrl ?? l.linkedin_url ?? null) as string | null,
    email:        (l.email ?? null) as string | null,
  }));

  const intakeResult = contacts.length > 0
    ? await intakeContactsForCompany(db, params.id, contacts).catch(() => null)
    : null;

  const summary = intakeResult?.ok
    ? { yes: intakeResult.yes, no: intakeResult.no, skipped: intakeResult.skipped }
    : { yes: 0, no: 0, skipped: 0 };

  if (summary.yes > 0) {
    await db.from("companies")
      .update({ clay_no_contacts_at: null, sales_nav_status: null })
      .eq("id", params.id);
  }

  return NextResponse.json({
    staged_total:  leads.length,
    staged_leads:  leads.slice(0, 30).map(l => ({
      company_name: l.companyName ?? l.company_name ?? null,
      job_title:    l.jobTitle    ?? l.job_title    ?? null,
      linkedin_url: l.linkedinUrl ?? l.linkedin_url ?? null,
    })),
    matched_count: matched.length,
    imported:      [],
    summary,
    matched_url:   all ? "all" : "by_name"
  });
}
