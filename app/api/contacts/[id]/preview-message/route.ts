import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateMessages, type MessageInput } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/preview-message
// Genera (o regenera) los mensajes de outreach para un contacto.
// Body opcional: { save?: boolean } — si true, guarda los mensajes en Supabase.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let save = false;
  try {
    const body = await req.json();
    save = !!body?.save;
  } catch {
    // Body opcional
  }

  const db = supabaseAdmin();

  // Cargar contacto
  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_headline, email, seniority, fit_reason, company_id, client_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Cargar empresa
  const { data: company } = await db
    .from("companies")
    .select("company_name, company_size, company_type, tool_primary, tool_secondary, fit_signals")
    .eq("id", contact.company_id)
    .maybeSingle();

  try {
    const input: MessageInput = {
      first_name: contact.first_name,
      last_name: contact.last_name,
      job_title: contact.job_title,
      linkedin_headline: contact.linkedin_headline,
      seniority: contact.seniority,
      company_name: company?.company_name ?? null,
      company_size: company?.company_size ?? null,
      company_type: company?.company_type ?? null,
      tool_primary: company?.tool_primary ?? null,
      tool_secondary: company?.tool_secondary ?? null,
      fit_signals: company?.fit_signals ?? null
    };

    const messages = await generateMessages(input);

    // Guardar si se solicitó
    if (save) {
      await db.from("contacts").update({
        linkedin_icebreaker: messages.linkedin_icebreaker,
        email_subject: messages.email_subject,
        email_body: messages.email_body
      }).eq("id", id);
    }

    return NextResponse.json({ ok: true, messages, saved: save });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
