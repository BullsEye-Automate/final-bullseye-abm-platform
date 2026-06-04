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

  // Usar exactamente la misma URL que el endpoint que ya funciona (sin offset)
  let res: Response;
  try {
    res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=500`,
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
    return NextResponse.json({ error: `Lemlist ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
  }

  const data = await res.json();
  const rawLeads: any[] = Array.isArray(data) ? data : (data.leads ?? data.list ?? []);

  if (rawLeads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // Debug: devolver el primer lead crudo para inspeccionar la estructura
  const debug = (req.nextUrl.searchParams.get("debug") === "1");
  if (debug) {
    return NextResponse.json({ sample: rawLeads[0], total: rawLeads.length });
  }

  // Normalizar campos (Lemlist mezcla camelCase y snake_case)
  // En Lemlist el _id del lead ES el email — usarlo como fallback
  const leads = rawLeads.map((l: any) => ({
    email:        (l.email ?? l._id ?? "").trim().toLowerCase(),
    first_name:   l.firstName   ?? l.first_name   ?? null,
    last_name:    l.lastName    ?? l.last_name     ?? null,
    company_name: l.companyName ?? l.company_name  ?? l.company ?? null,
    job_title:    l.jobTitle    ?? l.job_title     ?? l.title   ?? null,
    linkedin_url: l.linkedinUrl ?? l.linkedin_url  ?? l.linkedin ?? null,
    phone:        l.phone ?? null,
  }));

  const valid   = leads.filter((l) => l.email);
  const skipped = rawLeads.length - valid.length;

  // Cargar contactos existentes de este cliente que tengan linkedin_url
  // para poder cruzar email → contacto existente sin email
  const linkedinUrls = valid.map((l) => l.linkedin_url).filter(Boolean) as string[];
  const linkedinMap = new Map<string, string>(); // linkedin_url → contact id

  if (linkedinUrls.length > 0) {
    const { data: existing } = await db
      .from("contacts")
      .select("id, linkedin_url, email")
      .eq("client_id", client_id)
      .in("linkedin_url", linkedinUrls);

    for (const c of existing ?? []) {
      if (c.linkedin_url) linkedinMap.set(c.linkedin_url.toLowerCase(), c.id);
    }
  }

  let matched = 0;
  let created = 0;

  for (const lead of valid) {
    const linkedinKey = lead.linkedin_url?.toLowerCase();
    const existingId  = linkedinKey ? linkedinMap.get(linkedinKey) : undefined;

    if (existingId) {
      // Contacto ya existe por LinkedIn → solo actualizar email (y datos que falten)
      const update: Record<string, string> = { email: lead.email, lemlist_status: "active" };
      if (lead.first_name)   update.first_name   = lead.first_name;
      if (lead.last_name)    update.last_name    = lead.last_name;
      if (lead.company_name) update.company_name = lead.company_name;
      if (lead.job_title)    update.job_title    = lead.job_title;
      if (lead.phone)        update.phone        = lead.phone;

      const { error: updErr } = await db.from("contacts").update(update).eq("id", existingId);
      if (!updErr) matched++;
    } else {
      // No existe por LinkedIn → insertar fila nueva con email (ignorar si ya existe)
      const row: Record<string, string> = { client_id, email: lead.email, lemlist_status: "active" };
      if (lead.first_name)   row.first_name   = lead.first_name;
      if (lead.last_name)    row.last_name    = lead.last_name;
      if (lead.company_name) row.company_name = lead.company_name;
      if (lead.job_title)    row.job_title    = lead.job_title;
      if (lead.linkedin_url) row.linkedin_url = lead.linkedin_url;
      if (lead.phone)        row.phone        = lead.phone;

      const { error: insErr } = await db.from("contacts").insert(row);
      // ignorar conflictos de duplicados (código 23505)
      if (!insErr || (insErr as any).code === "23505") created++;
    }
  }

  return NextResponse.json({ imported: matched + created, matched, created, skipped });
}
