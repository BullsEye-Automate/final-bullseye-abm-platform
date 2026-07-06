import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany } from "@/lib/contactsIntake";
import { getLemlistApiKey } from "@/lib/lemlistKey";
import { getClientLemlistConfig, getCampaignLeadsWithDetails } from "@/lib/lemlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET: devuelve leads de la campaña puente sin importar (para mostrar checkboxes en la UI)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies").select("company_name, client_id").eq("id", params.id).single();
  if (compErr || !company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  if (!company.client_id) return NextResponse.json({ error: "La empresa no tiene cliente asignado" }, { status: 400 });

  const config = await getClientLemlistConfig(db, company.client_id);
  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) return NextResponse.json({ error: "No hay Campaña puente configurada. Agrégala en Config. cliente." }, { status: 400 });

  const apiKey = await getLemlistApiKey(db, company.client_id);
  if (!apiKey) return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 500 });

  const result = await getCampaignLeadsWithDetails(stagingId, apiKey);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  const companyWords = (company.company_name as string)
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w: string) => w.length > 3);

  return NextResponse.json({
    leads: result.leads.map((l) => {
      const lc = l.company_name.toLowerCase();
      const matched = companyWords.length > 0 ? companyWords.some((w: string) => lc.includes(w)) : false;
      return {
        key: l.id,
        firstName: l.first_name,
        lastName: l.last_name,
        jobTitle: l.job_title,
        companyName: l.company_name,
        linkedinUrl: l.linkedin_url,
        email: l.email,
        matched,
      };
    }),
    total: result.leads.length,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: company, error: compErr } = await db
    .from("companies").select("*").eq("id", params.id).single();
  if (compErr || !company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  if (!company.client_id) return NextResponse.json({ error: "La empresa no tiene cliente asignado" }, { status: 400 });

  const config = await getClientLemlistConfig(db, company.client_id);
  const stagingId = config?.lemlist_staging_campaign_id;
  if (!stagingId) return NextResponse.json({ error: "No hay Campaña puente configurada. Agrégala en Config. cliente." }, { status: 400 });

  const apiKey = await getLemlistApiKey(db, company.client_id);
  if (!apiKey) return NextResponse.json({ error: "No hay API key de Lemlist configurada" }, { status: 500 });

  const result = await getCampaignLeadsWithDetails(stagingId, apiKey);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  const leads = result.leads;
  if (!leads.length) {
    return NextResponse.json({ staged_total: 0, summary: { yes: 0, no: 0, skipped: 0 } });
  }

  let body: { lemlist_lead_ids?: string[]; auto_push_lemlist?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* ignorar */ }
  const selectedIds = Array.isArray(body.lemlist_lead_ids) ? body.lemlist_lead_ids : [];
  const autoPushLemlist = body.auto_push_lemlist === true;

  const matched = selectedIds.length > 0
    ? leads.filter((l) => selectedIds.includes(l.id))
    : leads.filter((l) => {
        const companyWords = (company.company_name as string)
          .toLowerCase()
          .replace(/[^a-záéíóúüñ\s]/gi, " ")
          .split(/\s+/)
          .filter((w: string) => w.length > 3);
        return companyWords.some((w: string) => l.company_name.toLowerCase().includes(w));
      });

  const contacts = matched.map((l) => ({
    first_name: l.first_name || null,
    last_name: l.last_name || null,
    job_title: l.job_title || null,
    linkedin_url: l.linkedin_url,
    email: l.email,
    phone: l.phone,
  }));

  const intakeResult = contacts.length > 0
    ? await intakeContactsForCompany(db, params.id, contacts, "sales_navigator", { auto_push_clay: false }).catch((err) => ({
        ok: false as const,
        status: 500,
        error: String(err?.message ?? err),
      }))
    : null;

  if (intakeResult && !intakeResult.ok) {
    return NextResponse.json({ error: intakeResult.error }, { status: intakeResult.status });
  }

  const summary = intakeResult?.ok
    ? {
        yes: intakeResult.summary.yes,
        no: intakeResult.summary.no,
        skipped: intakeResult.summary.skipped,
        duplicates: intakeResult.summary.duplicates,
      }
    : { yes: 0, no: 0, skipped: 0, duplicates: 0 };

  if (summary.yes > 0) {
    await db.from("companies")
      .update({ clay_no_contacts_at: null, sales_nav_status: null })
      .eq("id", params.id);
  }

  const outcomes = intakeResult?.ok ? intakeResult.outcomes : [];

  let autoPushResults: Record<string, unknown>[] = [];
  if (autoPushLemlist && summary.yes > 0) {
    const { data: yesContacts } = await db
      .from("contacts")
      .select("id")
      .eq("company_id", params.id)
      .eq("prefilter_result", "yes")
      .is("lemlist_pushed_at", null)
      .neq("status", "discarded");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
    if (baseUrl && yesContacts?.length) {
      const CHUNK = 3;
      for (let i = 0; i < yesContacts.length; i += CHUNK) {
        const slice = yesContacts.slice(i, i + CHUNK);
        const results = await Promise.all(
          slice.map(async (c) => {
            await db.from("contacts").update({ fit_action: "enrich" }).eq("id", c.id);
            try {
              const res = await fetch(`${baseUrl}/api/contacts/${c.id}/push-to-lemlist`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ force_regenerate: true }),
              });
              const json = await res.json().catch(() => ({}));
              return { contact_id: c.id, ok: res.ok, ...json };
            } catch (err: any) {
              return { contact_id: c.id, ok: false, error: err?.message ?? "Error de red" };
            }
          })
        );
        autoPushResults.push(...results);
      }
    }
  }

  return NextResponse.json({ staged_total: leads.length, summary, outcomes, auto_push_results: autoPushResults });
}
