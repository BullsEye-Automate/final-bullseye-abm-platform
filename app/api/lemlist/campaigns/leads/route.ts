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

  // Enriquecer con datos de Supabase — primero obtener los contactos de Lemlist (que tienen email)
  // para cruzarlos contra contacts en Supabase
  const contactIds = rawLeads.map((l: any) => l.contactId).filter(Boolean);

  if (contactIds.length > 0) {
    // Fetch en paralelo lotes de 10 para obtener email + linkedinUrl de cada contacto
    const lemContacts: any[] = [];
    const BATCH = 10;
    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batch = contactIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (cid: string) => {
          const r = await fetch(
            `https://api.lemlist.com/api/contacts/${cid}`,
            { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
          ).catch(() => null);
          if (!r?.ok) return null;
          const j = await r.json().catch(() => null);
          return j ? { ...j, _contactId: cid } : null;
        })
      );
      lemContacts.push(...results.filter(Boolean));
    }

    // Mapear contactId → datos de Lemlist
    const lemByContactId = new Map(lemContacts.map((c: any) => [c._contactId, c]));

    // Buscar en Supabase por email O linkedin_url
    const emails       = lemContacts.map((c) => c.email).filter(Boolean).map((e) => e.toLowerCase());
    const linkedinUrls = lemContacts.map((c) => c.linkedinUrl).filter(Boolean);

    const dbByEmail    = new Map<string, any>();
    const dbByLinkedin = new Map<string, any>();

    if (emails.length > 0) {
      const { data } = await db
        .from("contacts")
        .select("email, linkedin_url, first_name, last_name, company_name, job_title")
        .eq("client_id", clientId)
        .in("email", emails);
      for (const r of data ?? []) {
        if (r.email) dbByEmail.set(r.email.toLowerCase(), r);
      }
    }

    if (linkedinUrls.length > 0) {
      const { data } = await db
        .from("contacts")
        .select("email, linkedin_url, first_name, last_name, company_name, job_title")
        .eq("client_id", clientId)
        .in("linkedin_url", linkedinUrls);
      for (const r of data ?? []) {
        if (r.linkedin_url) dbByLinkedin.set(r.linkedin_url, r);
      }
    }

    // Enriquecer cada lead
    for (const lead of leads) {
      const rawLead = rawLeads.find((r: any) => r._id === lead._id);
      const lemC = rawLead?.contactId ? lemByContactId.get(rawLead.contactId) : null;
      if (!lemC) continue;

      // Email y LinkedIn vienen del contacto Lemlist
      if (lemC.email)       lead.email       = lemC.email.toLowerCase();
      if (lemC.linkedinUrl) lead.linkedinUrl = lemC.linkedinUrl;

      // Nombre desde fullName de Lemlist
      const fullName = (lemC.fullName ?? "").trim();
      if (fullName) {
        const parts = fullName.split(/\s+/);
        lead.firstName = parts[0] ?? "";
        lead.lastName  = parts.slice(1).join(" ") ?? "";
      }

      // Empresa y title desde fields de Lemlist
      const fields = lemC.fields ?? {};
      lead.companyName = fields.companyName ?? fields.company_name ?? lead.companyName;
      lead.jobTitle    = fields.jobTitle    ?? fields.job_title    ?? lead.jobTitle;

      // Si Supabase tiene datos mejores, usar esos
      const dbC = dbByEmail.get(lead.email) ?? dbByLinkedin.get(lead.linkedinUrl);
      if (dbC) {
        if (dbC.first_name && !lead.firstName)     lead.firstName   = dbC.first_name;
        if (dbC.last_name && !lead.lastName)       lead.lastName    = dbC.last_name;
        if (dbC.company_name && !lead.companyName) lead.companyName = dbC.company_name;
        if (dbC.job_title && !lead.jobTitle)       lead.jobTitle    = dbC.job_title;
      }
    }
  }

  return NextResponse.json({ leads });
}
