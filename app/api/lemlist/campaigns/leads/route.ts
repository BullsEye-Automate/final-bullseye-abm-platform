import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  // Obtener ID de campaña del cliente
  const db = supabaseAdmin();
  const { data: config, error: configError } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json(
      { error: "No hay campaña configurada en Config. cliente" },
      { status: 400 }
    );
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  let lemRes: Response;
  try {
    lemRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads?limit=100`,
      {
        headers: { Authorization: `Basic ${credentials}` },
        cache: "no-store",
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error de red: ${err?.message ?? "desconocido"}` },
      { status: 502 }
    );
  }

  if (!lemRes.ok) {
    const text = await lemRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Lemlist respondió ${lemRes.status}: ${text.slice(0, 200)}` },
      { status: 400 }
    );
  }

  const leadsData = await lemRes.json();
  // Lemlist puede retornar array directo o { leads: [...] }
  const rawLeads: any[] = Array.isArray(leadsData) ? leadsData : (leadsData.leads ?? []);

  // Normalizar campos de Lemlist
  const leads = rawLeads.map((l: any) => ({
    _id:         l._id ?? l.id ?? l.email,
    email:       (l.email ?? l._id ?? "").trim().toLowerCase(),
    firstName:   l.firstName   ?? l.first_name   ?? "",
    lastName:    l.lastName    ?? l.last_name     ?? "",
    companyName: l.companyName ?? l.company_name  ?? l.company ?? "",
    jobTitle:    l.jobTitle    ?? l.job_title     ?? l.title   ?? "",
    linkedinUrl: l.linkedinUrl ?? l.linkedin_url  ?? l.linkedin ?? "",
    isPaused:    l.isPaused    ?? l.is_paused     ?? false,
    isFinished:  l.isFinished  ?? l.is_finished   ?? false,
    completed:   l.completed   ?? null,
    addedAt:     l.addedAt     ?? l.added_at      ?? l.createdAt ?? null,
  }));

  // Enriquecer con datos de Supabase cruzando por lemlist_lead_id
  const leadIds = rawLeads.map((l: any) => l._id).filter(Boolean);
  if (leadIds.length > 0) {
    const { data: dbContacts } = await db
      .from("contacts")
      .select("lemlist_lead_id, email, first_name, last_name, company_name, job_title, linkedin_url")
      .eq("client_id", clientId)
      .in("lemlist_lead_id", leadIds);

    if (dbContacts && dbContacts.length > 0) {
      const byLeadId = new Map(dbContacts.map((c: any) => [c.lemlist_lead_id, c]));
      for (const lead of leads) {
        const rawLead = rawLeads.find((r: any) => r._id === lead._id);
        const c = byLeadId.get(rawLead?._id);
        if (!c) continue;
        if (c.email)        lead.email       = c.email;
        if (c.first_name)   lead.firstName   = c.first_name;
        if (c.last_name)    lead.lastName    = c.last_name;
        if (c.company_name) lead.companyName = c.company_name;
        if (c.job_title)    lead.jobTitle    = c.job_title;
        if (c.linkedin_url) lead.linkedinUrl = c.linkedin_url;
      }
    }
  }

  return NextResponse.json({ leads });
}
