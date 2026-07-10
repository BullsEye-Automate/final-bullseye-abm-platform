import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("review_sessions")
    .select("token, client_name, group_id, contacts, created_at, expires_at")
    .eq("token", params.token)
    .single();

  if (error || !data) return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "Este link de revisión ha expirado" }, { status: 410 });
  }

  // Si tiene group_id, leer mensajes en tiempo real desde message_group_contacts
  if (data.group_id) {
    const { data: groupContacts } = await db
      .from("message_group_contacts")
      .select("*")
      .eq("group_id", data.group_id)
      .order("contact_index", { ascending: true });

    if (groupContacts?.length) {
      const liveContacts = groupContacts.map((c) => ({
        firstName:     c.first_name,
        lastName:      c.last_name,
        email:         c.email,
        jobTitle:      c.job_title,
        companyName:   c.company_name,
        emailSubject:  c.email_subject,
        emailBody:     c.email_body,
        emailSubject2: c.email_subject_2,
        emailBody2:    c.email_body_2,
        emailSubject3: c.email_subject_3,
        emailBody3:    c.email_body_3,
        connectMessage: c.connect_message,
        icebreaker:    c.icebreaker,
        linkedinMsg2:  c.linkedin_msg_2,
        segmentName:   c.segment_name,
        icpWarning:    c.icp_warning,
      }));
      return NextResponse.json({ ...data, contacts: liveContacts });
    }
  }

  return NextResponse.json(data);
}
