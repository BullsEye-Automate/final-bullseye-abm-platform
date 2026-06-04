import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { client_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id } = body;
  if (!client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", client_id)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada para este cliente" }, { status: 400 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  // Paginar leads de Lemlist (máx 100 por página según API)
  const allLeads: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    let res: Response;
    try {
      res = await fetch(
        `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
        {
          headers: { Authorization: `Basic ${credentials}` },
          cache: "no-store",
        }
      );
    } catch (err: any) {
      return NextResponse.json({ error: `Error de red: ${err?.message}` }, { status: 502 });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Lemlist ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    // Lemlist puede devolver array directo o { leads: [] }
    const page: any[] = Array.isArray(data) ? data : (data.leads ?? []);
    allLeads.push(...page);

    if (page.length < limit) break;
    offset += limit;
  }

  if (allLeads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // Normalizar campos igual que campaigns/leads/route.ts (Lemlist mezcla camelCase y snake_case)
  const normalized = allLeads.map((l: any) => ({
    email:       (l.email ?? "").trim(),
    first_name:  l.firstName   ?? l.first_name   ?? null,
    last_name:   l.lastName    ?? l.last_name     ?? null,
    company_name: l.companyName ?? l.company_name ?? l.company ?? null,
    job_title:   l.jobTitle    ?? l.job_title     ?? l.title   ?? null,
    linkedin_url: l.linkedinUrl ?? l.linkedin_url ?? l.linkedin ?? null,
    phone:       l.phone ?? null,
    lemlist_status: "active",
  }));

  const valid   = normalized.filter((r) => r.email);
  const skipped = allLeads.length - valid.length;

  // Construir rows — solo incluir campos no-nulos para no pisar datos existentes en Supabase
  const rows = valid.map((r) => {
    const row: Record<string, string | null> = { client_id, email: r.email, lemlist_status: "active" };
    if (r.first_name)   row.first_name   = r.first_name;
    if (r.last_name)    row.last_name    = r.last_name;
    if (r.company_name) row.company_name = r.company_name;
    if (r.job_title)    row.job_title    = r.job_title;
    if (r.linkedin_url) row.linkedin_url = r.linkedin_url;
    if (r.phone)        row.phone        = r.phone;
    return row;
  });

  const { error: upsertError } = await db
    .from("contacts")
    .upsert(rows, { onConflict: "email,client_id" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ imported: rows.length, skipped });
}
