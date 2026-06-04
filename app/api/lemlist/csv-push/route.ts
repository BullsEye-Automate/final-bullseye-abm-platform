import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ContactToPush = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  emailSubject?: string;
  emailBody?: string;
  icebreaker?: string;
};

export async function POST(req: NextRequest) {
  let body: { client_id: string; contacts: ContactToPush[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id, contacts } = body;
  if (!client_id || !contacts?.length) {
    return NextResponse.json({ error: "Se requiere client_id y contacts" }, { status: 400 });
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

  let pushed = 0, skipped = 0;
  const errors: { email: string; error: string }[] = [];

  for (const contact of contacts) {
    const hasEmail = Boolean(contact.email?.trim());
    if (!hasEmail) {
      skipped++;
      continue;
    }

    const payload: Record<string, string | undefined> = {
      firstName:    contact.firstName    || undefined,
      lastName:     contact.lastName     || undefined,
      companyName:  contact.companyName  || undefined,
      linkedinUrl:  contact.linkedinUrl  || undefined,
      phone:        contact.phone        || undefined,
      icebreaker:   contact.icebreaker   || undefined,
      emailSubject: contact.emailSubject || undefined,
      emailBody:    contact.emailBody    || undefined,
    };

    // Eliminar keys undefined
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    let res: Response;
    try {
      res = await fetch(
        `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(contact.email)}?verifyEmail=false`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
    } catch (err: any) {
      errors.push({ email: contact.email, error: err?.message ?? "Error de red" });
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 409 || text.toLowerCase().includes("already")) {
        // Ya existe en la campaña — igual cuenta como pushed
        pushed++;
      } else {
        errors.push({ email: contact.email, error: `Lemlist ${res.status}: ${text.slice(0, 150)}` });
      }
      continue;
    }

    pushed++;

    // Guardar en Supabase con upsert por email+client_id
    const row: Record<string, string | null> = {
      client_id,
      email:        contact.email.trim(),
      first_name:   contact.firstName   || null,
      last_name:    contact.lastName    || null,
      job_title:    contact.jobTitle    || null,
      company_name: contact.companyName || null,
      linkedin_url: contact.linkedinUrl || null,
      phone:        contact.phone       || null,
      lemlist_status: "active",
    };
    await db.from("contacts").upsert(row, { onConflict: "email,client_id" });
  }

  return NextResponse.json({ pushed, skipped, errors });
}
