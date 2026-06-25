import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipos de actividad Lemlist con su puntaje y etiqueta
const ACTIVITY_TYPES = [
  { type: "emailsReplied",          score: 10, label: "Respondió email",        color: "#22c55e" },
  { type: "linkedinReplied",        score: 10, label: "Respondió en LinkedIn",  color: "#0a66c2" },
  { type: "linkedinInviteAccepted", score: 7,  label: "Aceptó conexión",        color: "#6366f1" },
  { type: "emailsClicked",          score: 5,  label: "Hizo clic en email",     color: "#f59e0b" },
  { type: "linkedinVisited",        score: 3,  label: "Visitó perfil LinkedIn", color: "#8b5cf6" },
  { type: "emailsOpened",           score: 2,  label: "Abrió email",            color: "#3b82f6" },
];

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const limit    = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "150", 10), 500);

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Obtener campaña configurada
  const { data: config } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña de Lemlist configurada para este cliente" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");
  const campaignId  = config.lemlist_campaign_id;

  // Traer todos los tipos de actividad en paralelo
  const fetches = await Promise.allSettled(
    ACTIVITY_TYPES.map(async ({ type, score, label, color }) => {
      try {
        const res = await fetch(
          `https://api.lemlist.com/api/activities?type=${type}&campaignId=${campaignId}&limit=${limit}`,
          { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
        );
        if (!res.ok) return [];
        const data   = await res.json();
        const items: any[] = Array.isArray(data) ? data : (data.data ?? data.activities ?? []);
        return items
          .map(a => ({
            type, score, label, color,
            email:      (a.email ?? a.leadEmail ?? "").trim().toLowerCase(),
            createdAt:  a.createdAt ?? a.date ?? null,
            activityId: a._id ?? a.id ?? null,
            firstName:  a.firstName ?? null,
            lastName:   a.lastName  ?? null,
            text:       a.text ?? a.body ?? null,
          }))
          .filter(a => a.email);
      } catch {
        return [];
      }
    })
  );

  // Agregar actividades por email
  type AggEntry = {
    totalScore: number;
    activities: any[];
    firstName?: string;
    lastName?: string;
  };

  const byEmail = new Map<string, AggEntry>();

  for (const result of fetches) {
    if (result.status !== "fulfilled") continue;
    for (const act of result.value) {
      const entry = byEmail.get(act.email) ?? { totalScore: 0, activities: [] };
      entry.totalScore += act.score;
      entry.activities.push({
        type:       act.type,
        score:      act.score,
        label:      act.label,
        color:      act.color,
        createdAt:  act.createdAt,
        activityId: act.activityId,
        text:       act.text,
      });
      if (!entry.firstName && act.firstName) entry.firstName = act.firstName;
      if (!entry.lastName  && act.lastName)  entry.lastName  = act.lastName;
      byEmail.set(act.email, entry);
    }
  }

  if (byEmail.size === 0) {
    return NextResponse.json({ contacts: [] });
  }

  const emails = Array.from(byEmail.keys());

  // Enriquecer con datos de Supabase
  const { data: contacts } = await db
    .from("contacts")
    .select(`id, email, first_name, last_name, job_title, phone, phone_clay, hubspot_contact_id, company_id,
             email_subject, email_body, email_subject_2, email_body_2, email_subject_3, email_body_3,
             linkedin_icebreaker, connect_message, linkedin_msg_2, lemlist_pushed_at, status, linkedin_url`)
    .eq("client_id", clientId)
    .in("email", emails);

  const contactByEmail = new Map((contacts ?? []).map(c => [c.email?.toLowerCase(), c]));

  // Nombres de empresas
  const companyIds = [...new Set((contacts ?? []).map(c => c.company_id).filter(Boolean) as string[])];
  let companyById  = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await db
      .from("companies")
      .select("id, company_name")
      .in("id", companyIds);
    companyById = new Map((companies ?? []).map(c => [c.id, c.company_name]));
  }

  // Labels SDR
  const contactIds = (contacts ?? []).map(c => c.id).filter(Boolean) as string[];
  let labelByContactId = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: labels } = await db
      .from("contact_sdr_labels")
      .select("contact_id, label")
      .in("contact_id", contactIds);
    labelByContactId = new Map((labels ?? []).map(l => [l.contact_id, l.label]));
  }

  // Construir resultado final
  const result = emails
    .map(email => {
      const agg     = byEmail.get(email)!;
      const contact = contactByEmail.get(email);
      const company = contact ? companyById.get(contact.company_id ?? "") : null;

      // Ordenar actividades por fecha desc
      const activities = agg.activities.sort((a, b) =>
        (b.createdAt ?? "") > (a.createdAt ?? "") ? 1 : -1
      );

      return {
        email,
        contact_id:          contact?.id ?? null,
        first_name:          contact?.first_name ?? agg.firstName ?? null,
        last_name:           contact?.last_name  ?? agg.lastName  ?? null,
        job_title:           contact?.job_title  ?? null,
        company_name:        company ?? null,
        phone:               contact?.phone ?? contact?.phone_clay ?? null,
        linkedin_url:        contact?.linkedin_url ?? null,
        hubspot_contact_id:  contact?.hubspot_contact_id ?? null,
        total_score:         agg.totalScore,
        activities,
        messages: contact ? {
          email1:           { subject: contact.email_subject,   body: contact.email_body    },
          email2:           { subject: contact.email_subject_2, body: contact.email_body_2  },
          email3:           { subject: contact.email_subject_3, body: contact.email_body_3  },
          linkedin_connect: contact.connect_message,
          linkedin_msg1:    contact.linkedin_icebreaker,
          linkedin_msg2:    contact.linkedin_msg_2,
        } : null,
        sdr_label:           contact ? (labelByContactId.get(contact.id) ?? null) : null,
        status:              contact?.status ?? null,
        lemlist_pushed_at:   contact?.lemlist_pushed_at ?? null,
      };
    })
    .filter(c => c.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score);

  return NextResponse.json({ contacts: result });
}
