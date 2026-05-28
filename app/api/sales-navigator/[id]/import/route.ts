import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function getStagingLeads(stagingId: string, apiKey: string) {
  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${stagingId}/leads?limit=100`,
    { headers: { Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}` } }
  ).catch(() => null);
  if (!leadsRes?.ok) return null;
  const payload = await leadsRes.json().catch(() => ({}));
  return (payload.items ?? (Array.isArray(payload) ? payload : [])) as Record<string, unknown>[];
}

// GET: devuelve leads de la campaña puente sin importar (para mostrar checkboxes en la UI)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies").select("company_name, client_id").eq("id", params.id).single();
  if (compErr || !company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_staging_campaign_id")
    .eq("client_id", company.client_id ?? "")
    .maybeSingle();

  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) return NextResponse.json({ error: "No hay Campaña puente configurada. Agregala en Config. cliente." }, { status: 400 });

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurada" }, { status: 500 });

  const leads = await getStagingLeads(stagingId, apiKey);
  if (!leads) return NextResponse.json({ error: "Error al conectar con Lemlist" }, { status: 502 });

  const companyWords = (company.company_name as string)
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w: string) => w.length > 3);

  return NextResponse.json({
    leads: leads.map(l => {
      const lc = ((l.companyName ?? l.company_name ?? "") as string).toLowerCase();
      const matched = companyWords.some((w: string) => lc.includes(w));
      return {
        key:          (l.email ?? l.linkedinUrl ?? l.linkedin_url ?? "") as string,
        firstName:    (l.firstName  ?? l.first_name  ?? "") as string,
        lastName:     (l.lastName   ?? l.last_name   ?? "") as string,
        jobTitle:     (l.jobTitle   ?? l.job_title   ?? "") as string,
        companyName:  (l.companyName ?? l.company_name ?? "") as string,
        linkedinUrl:  (l.linkedinUrl ?? l.linkedin_url ?? null) as string | null,
        email:        (l.email ?? null) as string | null,
        matched,
      };
    }),
    total: leads.length,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const all = req.nextUrl.searchParams.get("all") === "1";
  const db  = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies").select("*").eq("id", params.id).single();
  if (compErr || !company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_staging_campaign_id")
    .eq("client_id", company.client_id ?? "")
    .maybeSingle();

  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) return NextResponse.json({ error: "No hay Campaña puente configurada. Agregala en Config. cliente." }, { status: 400 });

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurada" }, { status: 500 });

  const leads = await getStagingLeads(stagingId, apiKey);
  if (!leads) return NextResponse.json({ error: "Error al conectar con Lemlist" }, { status: 502 });

  if (!leads.length) {
    return NextResponse.json({ staged_total: 0, summary: { yes: 0, no: 0, skipped: 0 } });
  }

  // Filtrar por keys seleccionadas (emails o linkedin URLs) o por nombre de empresa
  let selectedKeys: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    selectedKeys = Array.isArray(body?.selected_keys) ? body.selected_keys : [];
  } catch { /* ignorar */ }

  let matched: Record<string, unknown>[];
  if (selectedKeys.length > 0) {
    const keySet = new Set(selectedKeys);
    matched = leads.filter(l => {
      const key = (l.email ?? l.linkedinUrl ?? l.linkedin_url ?? "") as string;
      return keySet.has(key);
    });
  } else if (all) {
    matched = leads;
  } else {
    const companyWords = (company.company_name as string)
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 3);
    matched = leads.filter(l => {
      const lc = ((l.companyName ?? l.company_name ?? "") as string).toLowerCase();
      return companyWords.some((w: string) => lc.includes(w));
    });
  }

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

  return NextResponse.json({ staged_total: leads.length, summary });
}
