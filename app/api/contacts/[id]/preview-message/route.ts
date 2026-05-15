// Genera el mensaje IA para un contacto puntual y lo persiste. Usado
// desde el bucket "Por aprobar" para revisar el copy ANTES de pushear
// a Lemlist. Si el contacto ya tiene mensajes, los re-genera (force).
// La config activa de /entrenar-modelo aplica automáticamente.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateMessages, type MessageInput } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select(
      "id, company_id, first_name, last_name, job_title, linkedin_headline, " +
        "seniority"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  const { data: company } = await db
    .from("companies")
    .select(
      "company_name, company_size, company_type, cad_software, scanner_technology, fit_signals"
    )
    .eq("id", (contact as any).company_id)
    .maybeSingle();

  const input: MessageInput = {
    first_name: (contact as any).first_name ?? null,
    last_name: (contact as any).last_name ?? null,
    job_title: (contact as any).job_title ?? null,
    linkedin_headline: (contact as any).linkedin_headline ?? null,
    seniority: (contact as any).seniority ?? null,
    company_name: (company as any)?.company_name ?? null,
    company_size: (company as any)?.company_size ?? null,
    company_type: (company as any)?.company_type ?? null,
    cad_software: (company as any)?.cad_software ?? null,
    scanner_technology: (company as any)?.scanner_technology ?? null,
    fit_signals: (company as any)?.fit_signals ?? null
  };

  try {
    const result = await generateMessages(input);
    await db
      .from("contacts")
      .update({
        linkedin_icebreaker: result.linkedin_icebreaker,
        email_subject: result.email_subject,
        email_body: result.email_body,
        updated_at: new Date().toISOString()
      })
      .eq("id", params.id);

    return NextResponse.json({
      ok: true,
      messages: {
        linkedin_icebreaker: result.linkedin_icebreaker,
        email_subject: result.email_subject,
        email_body: result.email_body,
        model_used: result.model_used
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
