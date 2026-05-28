import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function getStagingLeads(stagingId: string, apiKey: string) {
  const creds = `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;

  const leadsRes = await fetch(
    `https://api.lemlist.com/api/campaigns/${stagingId}/leads?limit=100`,
    { headers: { Authorization: creds } }
  ).catch(() => null);
  if (!leadsRes?.ok) return null;
  const payload = await leadsRes.json().catch(() => ({}));
  const leads = (payload.items ?? (Array.isArray(payload) ? payload : [])) as Record<string, unknown>[];

  // Los leads de Lemlist solo traen _id, state y contactId.
  // Hay que enriquecer cada uno con los datos del contacto.
  const enriched = await Promise.all(
    leads.map(async (lead) => {
      const contactId = lead.contactId as string | undefined;
      if (!contactId) return lead;
      const res = await fetch(
        `https://api.lemlist.com/api/contacts/${contactId}`,
        { headers: { Authorization: creds } }
      ).catch(() => null);
      if (!res?.ok) return lead;
      const contact = await res.json().catch(() => ({}));
      return { ...contact, ...lead };
    })
  );

  return enriched;
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
      const f           = (l.fields ?? {}) as Record<string, unknown>;
      const firstName   = (f.firstName  ?? l.firstName  ?? l.first_name  ?? "") as string;
      const lastName    = (f.lastName   ?? l.lastName   ?? l.last_name   ?? "") as string;
      const jobTitle    = (f.jobTitle   ?? l.jobTitle   ?? l.job_title   ?? f.tagline ?? "") as string;
      const companyName = (f.companyName ?? l.companyName ?? l.company_name ?? "") as string;
      const email       = (l.email ?? f.email ?? null) as string | null;
      const linkedinUrl = (l.linkedinUrl ?? l.linkedin_url ?? null) as string | null;
      const key         = (l._id ?? l.contactId ?? email ?? linkedinUrl ?? "") as string;
      const lc          = companyName.toLowerCase();
      const matched     = companyWords.length > 0 ? companyWords.some((w: string) => lc.includes(w)) : false;
      return { key, firstName, lastName, jobTitle, companyName, linkedinUrl, email, matched };
    }),
    total: leads.length,
    _debug: leads[0] ?? null,
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
      const key = (l._id ?? l.contactId ?? l.email ?? l.linkedinUrl ?? "") as string;
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
      const f  = (l.fields ?? {}) as Record<string, unknown>;
      const cn = ((f.companyName ?? l.companyName ?? l.company_name ?? "") as string).toLowerCase();
      return companyWords.some((w: string) => cn.includes(w));
    });
  }

  const contacts = matched.map(l => {
    const f = (l.fields ?? {}) as Record<string, unknown>;
    return {
      first_name:   (f.firstName  ?? l.firstName  ?? l.first_name  ?? null) as string | null,
      last_name:    (f.lastName   ?? l.lastName   ?? l.last_name   ?? null) as string | null,
      job_title:    (f.jobTitle   ?? l.jobTitle   ?? l.job_title   ?? null) as string | null,
      linkedin_url: (l.linkedinUrl ?? l.linkedin_url ?? null) as string | null,
      email:        (l.email ?? f.email ?? null) as string | null,
    };
  });

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
