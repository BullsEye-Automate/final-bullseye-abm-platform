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

  // Lemlist no soporta offset confiablemente — paginamos con limit/offset solo si la respuesta llega llena
  const allLeads: any[] = [];
  const limit = 100;
  let page = 0;
  let safetyBreak = 0;

  while (safetyBreak < 20) {
    safetyBreak++;
    const url = `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${page * limit}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Basic ${credentials}` },
        cache: "no-store",
      });
    } catch (err: any) {
      return NextResponse.json({ error: `Error de red: ${err?.message}` }, { status: 502 });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Devolver debug para entender qué pasa
      return NextResponse.json({
        error: `Lemlist ${res.status}: ${text.slice(0, 300)}`,
        debug: { url, page },
      }, { status: 502 });
    }

    const data = await res.json();

    // Lemlist puede devolver array directo, { leads: [] }, o incluso { list: [] }
    let chunk: any[];
    if (Array.isArray(data)) {
      chunk = data;
    } else if (Array.isArray(data.leads)) {
      chunk = data.leads;
    } else if (Array.isArray(data.list)) {
      chunk = data.list;
    } else {
      // Respuesta inesperada — devolver para debug
      return NextResponse.json({
        error: "Formato de respuesta inesperado de Lemlist",
        debug: { keys: Object.keys(data), sample: JSON.stringify(data).slice(0, 400) },
      }, { status: 502 });
    }

    allLeads.push(...chunk);

    // Si la página vino incompleta, no hay más
    if (chunk.length < limit) break;
    page++;
  }

  if (allLeads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, debug: "Lemlist devolvió 0 leads" });
  }

  // Normalizar campos (Lemlist mezcla camelCase y snake_case según versión)
  const normalized = allLeads.map((l: any) => ({
    email:        (l.email ?? "").trim().toLowerCase(),
    first_name:   l.firstName   ?? l.first_name   ?? null,
    last_name:    l.lastName    ?? l.last_name     ?? null,
    company_name: l.companyName ?? l.company_name ?? l.company ?? null,
    job_title:    l.jobTitle    ?? l.job_title     ?? l.title   ?? null,
    linkedin_url: l.linkedinUrl ?? l.linkedin_url ?? l.linkedin ?? null,
    phone:        l.phone       ?? null,
  }));

  const valid   = normalized.filter((r) => r.email);
  const skipped = allLeads.length - valid.length;

  // Solo incluir campos con valor para no pisar datos de Clay/Supabase existentes
  const rows = valid.map((r) => {
    const row: Record<string, string> = { client_id, email: r.email, lemlist_status: "active" };
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
