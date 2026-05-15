import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { draftReply } from "@/lib/replyDrafter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/respuestas/[id]/draft
//
// Genera con Claude un borrador de respuesta para una actividad de tipo
// reply del inbox /respuestas. Usa como contexto el texto de la respuesta
// del prospecto, su clasificación, y el contacto + empresa. No envía nada:
// solo devuelve el borrador para que el SDR lo revise y edite.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();

  const { data: act, error } = await db
    .from("lemlist_activities")
    .select(
      "id, channel, type, reply_text, reply_category, reply_triage, contact_id, lead_email"
    )
    .eq("id", params.id)
    .single();
  if (error || !act) {
    return NextResponse.json(
      { error: error?.message ?? "respuesta no encontrada" },
      { status: 404 }
    );
  }
  if (!act.reply_text) {
    return NextResponse.json(
      {
        error:
          "Esta respuesta no tiene texto extraído — la IA no tiene contexto para sugerir un borrador. Escribila a mano."
      },
      { status: 400 }
    );
  }

  // Contexto del contacto + empresa (best-effort: la actividad puede no estar
  // matcheada a un contacto nuestro).
  let contact: {
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    company_id: string | null;
  } | null = null;
  let company: {
    company_name: string | null;
    company_type: string | null;
    cad_software: string | null;
    fit_signals: string | null;
  } | null = null;

  if (act.contact_id) {
    const { data: c } = await db
      .from("contacts")
      .select("first_name, last_name, job_title, company_id")
      .eq("id", act.contact_id)
      .single();
    contact = c ?? null;
    if (c?.company_id) {
      const { data: co } = await db
        .from("companies")
        .select("company_name, company_type, cad_software, fit_signals")
        .eq("id", c.company_id)
        .single();
      company = co ?? null;
    }
  }

  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null
    : act.lead_email ?? null;

  try {
    const result = await draftReply({
      channel: act.channel,
      incoming_text: act.reply_text,
      category: act.reply_triage ?? act.reply_category ?? null,
      contact_name: contactName,
      first_name: contact?.first_name ?? null,
      job_title: contact?.job_title ?? null,
      company_name: company?.company_name ?? null,
      company_type: company?.company_type ?? null,
      cad_software: company?.cad_software ?? null,
      fit_signals: company?.fit_signals ?? null
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "no se pudo generar el borrador";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
