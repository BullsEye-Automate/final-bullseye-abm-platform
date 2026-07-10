import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/message-groups/[id]/contacts
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("message_group_contacts")
    .select("*")
    .eq("group_id", params.id)
    .order("contact_index", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/message-groups/[id]/contacts — guardar resultado de un contacto generado
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || body.contact_index === undefined) {
    return NextResponse.json({ error: "contact_index requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Upsert por group_id + contact_index
  const { data, error } = await db
    .from("message_group_contacts")
    .upsert({
      group_id:           params.id,
      contact_index:      body.contact_index,
      first_name:         body.firstName         ?? null,
      last_name:          body.lastName          ?? null,
      email:              body.email             ?? null,
      phone:              body.phone             ?? null,
      job_title:          body.jobTitle          ?? null,
      company_name:       body.companyName       ?? null,
      linkedin_url:       body.linkedinUrl       ?? null,
      industry:           body.industry          ?? null,
      company_size:       body.companySize       ?? null,
      email_subject:      body.emailSubject      ?? null,
      email_body:         body.emailBody         ?? null,
      email_subject_2:    body.emailSubject2     ?? null,
      email_body_2:       body.emailBody2        ?? null,
      email_subject_3:    body.emailSubject3     ?? null,
      email_body_3:       body.emailBody3        ?? null,
      connect_message:    body.connectMessage    ?? null,
      icebreaker:         body.icebreaker        ?? null,
      linkedin_msg_2:     body.linkedinMsg2      ?? null,
      segment_name:       body.segmentName       ?? null,
      deep_research_used: body.deepResearchUsed  ?? false,
      icp_warning:        body.icpWarning        ?? false,
      status:             body.status            ?? "generated",
      error_message:      body.error             ?? null,
      generated_at:       body.status === "generated" ? new Date().toISOString() : null,
    }, { onConflict: "group_id,contact_index" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Actualizar contadores del grupo
  const { data: counts } = await db
    .from("message_group_contacts")
    .select("status")
    .eq("group_id", params.id);

  if (counts) {
    const generated = counts.filter((c) => c.status === "generated").length;
    const errors    = counts.filter((c) => c.status === "error").length;
    const total     = counts.length;
    const allDone   = generated + errors + counts.filter((c) => c.status === "cancelled").length === total;

    await db.from("message_groups").update({
      generated_count: generated,
      error_count:     errors,
      status:          allDone ? "ready" : "generating",
      updated_at:      new Date().toISOString(),
    }).eq("id", params.id);
  }

  return NextResponse.json(data);
}
