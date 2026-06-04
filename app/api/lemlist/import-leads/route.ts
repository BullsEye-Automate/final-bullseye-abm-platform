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

  // Paginar leads de Lemlist (offset/limit)
  const allLeads: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Lemlist ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    // Lemlist puede devolver array directo o { leads: [] }
    const page: Record<string, unknown>[] = Array.isArray(data) ? data : (data.leads ?? []);
    allLeads.push(...page);

    if (page.length < limit) break;
    offset += limit;
  }

  if (allLeads.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // Construir rows para upsert
  const rows = allLeads
    .filter((l) => typeof l.email === "string" && l.email)
    .map((l) => ({
      client_id,
      email:          (l.email as string).trim(),
      first_name:     (l.firstName  as string | undefined) ?? null,
      last_name:      (l.lastName   as string | undefined) ?? null,
      job_title:      (l.jobTitle   as string | undefined) ?? null,
      company_name:   (l.companyName as string | undefined) ?? null,
      linkedin_url:   (l.linkedinUrl as string | undefined) ?? null,
      phone:          (l.phone      as string | undefined) ?? null,
      lemlist_status: "active",
    }));

  const skipped = allLeads.length - rows.length;

  const { error: upsertError } = await db
    .from("contacts")
    .upsert(rows, { onConflict: "email,client_id" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ imported: rows.length, skipped });
}
